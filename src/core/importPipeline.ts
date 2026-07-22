/**
 * core/importPipeline.ts
 * Import: decodare la 2048px -> preview + miniatura + dHash -> analiza ML (worker)
 * -> scor ContextEngine -> persistare IndexedDB -> grupare serii (persistata).
 * Preview-ul de 2048px (standard Lightroom) este cel pe care se judeca claritatea.
 */
import { db, type AnalysisRecord, type PhotoRecord } from './db';
import { analysisPool } from './workerPool';
import { contextEngine, type Prediction } from './learning/ContextEngine';

export interface ImportProgress {
  done: number;
  total: number;
  fileName: string;
  phase: 'analiza' | 'grupare' | 'finalizat';
  /** setat doar pe ultimul apel, daca importul s-a oprit inainte de a termina toate fisierele */
  warning?: string;
}

export interface ImportedPhoto {
  photo: PhotoRecord;
  analysis: AnalysisRecord;
  prediction: Prediction;
}

const PREVIEW_MAX_SIDE = 2048;
const THUMB_SIZE = 512;
const SELECT_THRESHOLD = 65;
const REJECT_THRESHOLD = 35;
const DHASH_DISTANCE = 8;

/**
 * Fisierele originale raman disponibile doar in memorie, pentru sesiunea
 * curenta de import — nu sunt persistate in IndexedDB (ar dubla spatiul
 * ocupat de 1000+ poze originale, unele RAW de zeci de MB). Un File e un
 * handle lazy catre disc, nu bytes incarcati in RAM, deci pastrarea
 * referintei e ieftina; abia exportOriginalFiles() ii citeste continutul.
 * La reload de pagina se pierde — pozele reincarcate din DB nu mai pot fi
 * exportate in format original decat prin reimport.
 */
export const originalFiles = new Map<string, File>();

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, {
      resizeWidth: PREVIEW_MAX_SIDE,
      resizeQuality: 'high'
    } as ImageBitmapOptions);
  } catch {
    return await createImageBitmap(file);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
  );
}

function makeDerivatives(bitmap: ImageBitmap): {
  preview: Promise<Blob>; thumb: Promise<Blob>; dHash: string; w: number; h: number;
} {
  // Preview la rezolutia decodata (max 2048) — pe acesta se evalueaza claritatea
  const pc = document.createElement('canvas');
  pc.width = bitmap.width; pc.height = bitmap.height;
  pc.getContext('2d')!.drawImage(bitmap, 0, 0);
  const preview = canvasToJpeg(pc, 0.88);

  // Miniatura pentru grila
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
  const tc = document.createElement('canvas');
  tc.width = Math.max(1, Math.round(bitmap.width * scale));
  tc.height = Math.max(1, Math.round(bitmap.height * scale));
  tc.getContext('2d')!.drawImage(bitmap, 0, 0, tc.width, tc.height);
  const thumb = canvasToJpeg(tc, 0.82);

  // dHash 9x8 pentru serii/duplicate
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

  return { preview, thumb, dHash: hash, w: bitmap.width, h: bitmap.height };
}

function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

const QUOTA_SAFETY_MARGIN = 0.92; // oprim importul la 92% din cota de stocare a originii, nu la eroare

/** navigator.storage e indisponibila pe unele browsere vechi — in acel caz nu putem
    verifica preventiv, continuam si ne bazam doar pe catch-ul QuotaExceededError. */
async function isStorageNearFull(): Promise<boolean> {
  if (!navigator.storage?.estimate) return false;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return false;
    return (usage ?? 0) / quota >= QUOTA_SAFETY_MARGIN;
  } catch {
    return false;
  }
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

async function processOne(file: File): Promise<ImportedPhoto> {
  const id = crypto.randomUUID();
  originalFiles.set(id, file);
  const bitmap = await decode(file);
  const { preview, thumb, dHash, w, h } = makeDerivatives(bitmap);

  // Bitmap-ul pleaca in worker (transfer, zero-copy) — de aici nu-l mai atingem
  const analysisPromise = analysisPool.analyze(id, bitmap);
  const [previewBlob, thumbBlob] = await Promise.all([preview, thumb]);

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
    db.previews.put({ photoId: id, blob: previewBlob }),
    db.analyses.put(analysis),
    // pastram originalul si pentru auto-selectiile AI (nu doar corectiile
    // manuale) — altfel exportul s-ar rupe la un reload inainte ca utilizatorul
    // sa apuce sa atinga poza (vezi syncOriginal in state/store.ts)
    ...(status === 'selected'
      ? [db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type })]
      : [])
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
  let stopReason: string | undefined;
  const hashes: { id: string; dHash: string; score: number }[] = [];

  const stopMessage = (n: number) =>
    `Spatiu de stocare aproape plin — import oprit la ${n}/${images.length}. ` +
    `Exporta ce ai deja sau elibereaza spatiu (Goleste sesiunea / sterge pozele respinse) ca sa continui.`;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        if (stopReason) break;
        // index++ e sincron (fara await intre citire si incrementare), deci fiecare
        // worker concurent primeste un index unic — esential cu putine fisiere si
        // mai multi workeri, altfel doi workeri pot "sari" peste array simultan
        // si ajunge unul cu file === undefined (vezi verificarea de cota de mai jos,
        // care ADAUGA un await inainte de a citi fisierul, deci trebuia sa vina dupa).
        const myIndex = index++;
        if (myIndex >= images.length) break;
        const file = images[myIndex];

        // verificare periodica (nu la fiecare fisier — storage.estimate() nu e gratuit)
        if (myIndex % 15 === 0 && await isStorageNearFull()) {
          stopReason = stopMessage(done);
          break;
        }
        try {
          const item = await processOne(file);
          hashes.push({ id: item.photo.id, dHash: item.photo.dHash, score: item.analysis.aiScore });
          onPhoto(item);
        } catch (err) {
          if (isQuotaError(err)) { stopReason = stopMessage(done); break; }
          console.error('Analiza a esuat pentru ' + file.name + ':', err);
        }
        done++;
        onProgress({ done, total: images.length, fileName: file.name, phase: 'analiza' });
      }
    })
  );

  // Grupare serii/duplicate (dHash), PERSISTATA in DB: cea mai buna ramane propusa,
  // restul trec la "review" ca variante de comparat.
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
        const patch: Partial<PhotoRecord> = { groupId };
        if (m !== best) {
          const rec = await db.photos.get(hashes[m].id);
          if (rec && rec.status === 'selected') patch.status = 'review';
        }
        await db.photos.update(hashes[m].id, patch);
      }
    }
  }

  onProgress({ done, total: images.length, fileName: '', phase: 'finalizat', warning: stopReason });
  return groups;
}
