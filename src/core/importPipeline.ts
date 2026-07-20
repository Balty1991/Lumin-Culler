/**
 * core/importPipeline.ts
 * Fluxul complet de import: decodare -> miniatura -> dHash -> analiza ML (worker)
 * -> scor ContextEngine -> persistare IndexedDB -> grupare duplicate.
 * RAM plat: concurenta limitata, bitmap-urile sunt transferate si inchise imediat.
 */
import { db, type AnalysisRecord, type PhotoRecord } from './db';
import { analysisPool } from './workerPool';
import { contextEngine, type Prediction } from './learning/ContextEngine';

export interface ImportProgress {
  done: number;
  total: number;
  fileName: string;
  phase: 'analiza' | 'grupare' | 'finalizat';
}

export interface ImportedPhoto {
  photo: PhotoRecord;
  analysis: AnalysisRecord;
  prediction: Prediction;
}

const ANALYSIS_MAX_SIDE = 1024;
const THUMB_SIZE = 512;
const SELECT_THRESHOLD = 65;
const REJECT_THRESHOLD = 35;
const DHASH_DISTANCE = 8;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, {
      resizeWidth: ANALYSIS_MAX_SIDE,
      resizeQuality: 'medium'
    } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(file);
  }
}

function makeThumbAndHash(bitmap: ImageBitmap): { blob: Promise<Blob>; dHash: string; w: number; h: number } {
  const scale = THUMB_SIZE / Math.max(bitmap.width, bitmap.height);
  const tw = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
  const th = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));

  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, tw, th);

  // dHash 9x8 pe grayscale — hash perceptual pentru duplicate
  const hc = document.createElement('canvas');
  hc.width = 9; hc.height = 8;
  const hctx = hc.getContext('2d', { willReadFrequently: true })!;
  hctx.drawImage(bitmap, 0, 0, 9, 8);
  const d = hctx.getImageData(0, 0, 9, 8).data;
  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      const j = (y * 9 + x + 1) * 4;
      const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      hash += a > b ? '1' : '0';
    }
  }

  const blob = new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85)
  );
  return { blob, dHash: hash, w: bitmap.width, h: bitmap.height };
}

function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

async function processOne(file: File): Promise<ImportedPhoto> {
  const id = crypto.randomUUID();
  const bitmap = await decode(file);
  const { blob, dHash, w, h } = makeThumbAndHash(bitmap);

  // Bitmap-ul pleaca in worker (transfer, zero-copy) — de aici nu-l mai atingem
  const analysisPromise = analysisPool.analyze(id, bitmap);
  const thumbBlob = await blob;

  const analysis = await analysisPromise;
  const prediction = await contextEngine.predict(analysis);
  analysis.aiScore = prediction.score;

  const status: PhotoRecord['status'] =
    prediction.score >= SELECT_THRESHOLD ? 'selected'
    : prediction.score <= REJECT_THRESHOLD ? 'rejected'
    : 'review';

  const photo: PhotoRecord = {
    id,
    fileName: file.name,
    capturedAt: file.lastModified,
    importedAt: Date.now(),
    width: w,
    height: h,
    dHash,
    status
  };

  await Promise.all([
    db.photos.put(photo),
    db.thumbnails.put({ photoId: id, blob: thumbBlob }),
    db.analyses.put(analysis)
  ]);

  return { photo, analysis, prediction };
}

export async function importFiles(
  files: File[],
  onProgress: (p: ImportProgress) => void,
  onPhoto: (item: ImportedPhoto) => void
): Promise<Map<string, string>> {
  await analysisPool.init();
  await contextEngine.init();
  const persons = await db.persons.toArray();
  await analysisPool.setKnownPersons(persons);

  const images = files.filter(f => /image\/(jpeg|png|webp|avif)/.test(f.type) || /\.(jpe?g|png|webp|avif)$/i.test(f.name));
  const concurrency = analysisPool.size + 1;
  let done = 0;
  let index = 0;
  const hashes: { id: string; dHash: string; score: number }[] = [];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < images.length) {
        const file = images[index++];
        try {
          const item = await processOne(file);
          hashes.push({ id: item.photo.id, dHash: item.photo.dHash, score: item.analysis.aiScore });
          onPhoto(item);
        } catch (err) {
          console.error('Analiza a esuat pentru ' + file.name + ':', err);
        }
        done++;
        onProgress({ done, total: images.length, fileName: file.name, phase: 'analiza' });
      }
    })
  );

  // Grupare duplicate/serii (dHash): cel mai bun scor din grup ramane propus,
  // restul trec la "review" ca variante.
  onProgress({ done, total: images.length, fileName: '', phase: 'grupare' });
  const groups = new Map<string, string>();
  const assigned = new Set<number>();
  for (let i = 0; i < hashes.length; i++) {
    if (assigned.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < hashes.length; j++) {
      if (!assigned.has(j) && hammingDistance(hashes[i].dHash, hashes[j].dHash) <= DHASH_DISTANCE) {
        members.push(j); assigned.add(j);
      }
    }
    if (members.length > 1) {
      const groupId = 'g-' + hashes[i].id.slice(0, 8);
      const best = members.reduce((a, b) => (hashes[a].score >= hashes[b].score ? a : b));
      for (const m of members) {
        groups.set(hashes[m].id, groupId);
        if (m !== best) {
          const rec = await db.photos.get(hashes[m].id);
          if (rec && rec.status === 'selected') await db.photos.update(hashes[m].id, { status: 'review' });
        }
      }
    }
  }

  onProgress({ done, total: images.length, fileName: '', phase: 'finalizat' });
  return groups;
}
