/**
 * core/importPipeline.ts
 * Import: decodare la 2048px -> preview + miniatura + dHash -> analiza ML (worker)
 * -> scor ContextEngine -> persistare IndexedDB -> grupare serii (persistata).
 * Preview-ul de 2048px (standard Lightroom) este cel pe care se judeca claritatea.
 */
import { db, type AnalysisRecord, type PhotoRecord } from './db';
import { analysisPool, withTimeout } from './workerPool';
import { contextEngine, type Prediction } from './learning/ContextEngine';
import { groupPhotosByHash } from './hashComparePool';
import { parseExif } from './exifParser';
import { isRawFile, decodeRawFile, RAW_EXTENSIONS } from './rawDecoder';

export interface ImportProgress {
  done: number;
  total: number;
  fileName: string;
  phase: 'incarcare' | 'analiza' | 'grupare' | 'finalizat';
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
/** EXIF sta mereu aproape de inceputul fisierului (segment APP1, imediat dupa
    SOI) — citim doar un prefix, nu tot fisierul, ca sa nu incarcam inutil in
    memorie poze mari doar pentru cativa octeti de metadate. */
const EXIF_SNIFF_BYTES = 131072;

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

const DECODE_TIMEOUT_MS = 30000;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await withTimeout(
      createImageBitmap(file, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions),
      DECODE_TIMEOUT_MS,
      'Decodarea a durat prea mult.'
    );
  } catch {
    return await withTimeout(createImageBitmap(file), DECODE_TIMEOUT_MS, 'Decodarea a durat prea mult.');
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

/**
 * Nu ne bazam pe navigator.storage.estimate() pentru a opri importul preventiv:
 * raportarea e nesigura in practica — Brave, de exemplu, ofusca deliberat
 * usage/quota din motive de anti-fingerprinting, ceea ce a produs opriri false
 * ("stocare aproape plina") chiar si cu 2 poze mici pe un telefon cu spatiu liber.
 * Reactionam DOAR la un esec real de scriere (QuotaExceededError), singurul
 * semnal 100% de incredere — reflecta o eroare reala, nu o estimare.
 */
function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

/**
 * Verifica formatul REAL al fisierului din primii octeti (magic bytes), nu din
 * extensie/MIME — unele telefoane (multe Samsung/Xiaomi) salveaza pozele in
 * HEIC/HEIF dar le expun aplicatiilor cu extensia .jpg si MIME "image/jpeg"
 * (compatibilitate "falsa"), ceea ce trece de filtrul de format dar pica la
 * decodare cu "InvalidStateError: source image could not be decoded" —
 * Chromium pe Android nu decodeaza HEIC in <canvas>. Folosit doar cand
 * decodarea a esuat deja, ca sa dam un motiv exact, nu o presupunere.
 */
async function sniffRealFormat(file: File): Promise<string | null> {
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return null; // JPEG real — nu e asta problema
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return null; // PNG real
    if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return null; // WEBP real
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { // 'ftyp' -> container ISO BMFF
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(brand)) return 'HEIC/HEIF';
      if (/^(avif|avis)$/.test(brand)) return 'AVIF';
      return 'necunoscut (' + brand + ')';
    }
    return 'necunoscut';
  } catch {
    return null;
  }
}

async function processOne(file: File): Promise<ImportedPhoto> {
  const id = crypto.randomUUID();
  originalFiles.set(id, file);
  const isRaw = isRawFile(file);
  // RAW (CR2/NEF/ARW/DNG/...) nu se decodeaza cu createImageBitmap — folosim
  // LibRaw (WASM); metadatele EXIF vin direct din LibRaw (mai fiabil decat
  // sniff-ul de octeti gandit pentru JPEG, care nu intelege containerul RAW).
  const { bitmap, rawMeta } = isRaw
    ? await decodeRawFile(file).then(r => ({ bitmap: r.bitmap, rawMeta: r.meta }))
    : { bitmap: await decode(file), rawMeta: undefined };
  const { preview, thumb, dHash, w, h } = makeDerivatives(bitmap);

  // Bitmap-ul pleaca in worker (transfer, zero-copy) — de aici nu-l mai atingem
  const analysisPromise = analysisPool.analyze(id, bitmap);
  const [previewBlob, thumbBlob] = await Promise.all([preview, thumb]);

  const analysis = await analysisPromise;

  // EXIF (ISO/diafragma/timp expunere/focala) — optional, poze fara EXIF
  // (PNG/WebP sau JPEG cu metadate sterse) nu primesc aceste campuri deloc
  if (rawMeta) {
    if (rawMeta.iso !== undefined) analysis.iso = rawMeta.iso;
    if (rawMeta.fNumber !== undefined) analysis.fNumber = rawMeta.fNumber;
    if (rawMeta.exposureTime !== undefined) analysis.exposureTime = rawMeta.exposureTime;
    if (rawMeta.focalLength !== undefined) analysis.focalLength = rawMeta.focalLength;
  } else {
    try {
      const exifBuf = await file.slice(0, EXIF_SNIFF_BYTES).arrayBuffer();
      const exif = parseExif(exifBuf);
      if (exif.iso !== undefined) analysis.iso = exif.iso;
      if (exif.fNumber !== undefined) analysis.fNumber = exif.fNumber;
      if (exif.exposureTime !== undefined) analysis.exposureTime = exif.exposureTime;
      if (exif.focalLength !== undefined) analysis.focalLength = exif.focalLength;
    } catch (err) {
      console.error('Citire EXIF esuata pentru ' + file.name + ':', err);
    }
  }

  const prediction = await contextEngine.predict(analysis);
  analysis.aiScore = prediction.score;
  analysis.aiFactors = prediction.topFactors;

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
  // faza separata (nu "analiza 0/N"): la primul import, descarca modelele AI
  // (cateva zeci de MB) — poate dura, si utilizatorul trebuie sa stie de ce.
  onProgress({ done: 0, total: files.length, fileName: '', phase: 'incarcare' });
  await analysisPool.init();
  await contextEngine.init();
  const persons = await db.persons.toArray();
  await analysisPool.setKnownPersons(persons);

  const images = files.filter(f =>
    /image\/(jpeg|png|webp|avif)/.test(f.type) || /\.(jpe?g|png|webp|avif)$/i.test(f.name) || RAW_EXTENSIONS.test(f.name)
  );
  // Daca niciun fisier ales nu are un format suportat (ex. HEIC/HEIF de pe iPhone,
  // sau un director gol), bucla de mai jos nu are ce procesa si totul se termina
  // instant, fara nicio poza si fara nicio eroare — utilizatorul vede doar ca
  // "nu s-a intamplat nimic". Semnalam explicit acest caz.
  if (images.length === 0) {
    const warning = files.length > 0
      ? `Niciunul dintre cele ${files.length} fisiere alese nu e intr-un format suportat ` +
        `(JPEG/PNG/WebP/AVIF/RAW). HEIC/HEIF de pe iPhone nu e suportat inca — converteste-le in JPEG.`
      : undefined;
    onProgress({ done: 0, total: 0, fileName: '', phase: 'finalizat', warning });
    return new Map();
  }

  const concurrency = analysisPool.size + 1;
  let done = 0;
  let index = 0;
  let failed = 0;
  let stopReason: string | undefined;
  const hashes: { id: string; dHash: string; score: number }[] = [];
  // Motivele reale (distincte) ale esecurilor — altfel "fisier corupt sau
  // format neasteptat" e un mesaj generic care nu spune nimic despre CE
  // anume a esuat (memorie, decodare, worker etc.), imposibil de diagnosticat
  // de la distanta fara acces la consola browserului utilizatorului.
  const failureReasons = new Map<string, number>();

  const stopMessage = (n: number) =>
    `Spatiu de stocare aproape plin — import oprit la ${n}/${images.length}. ` +
    `Exporta ce ai deja sau elibereaza spatiu (Goleste sesiunea / sterge pozele respinse) ca sa continui.`;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        if (stopReason) break;
        const myIndex = index++;
        if (myIndex >= images.length) break;
        const file = images[myIndex];

        try {
          const item = await processOne(file);
          hashes.push({ id: item.photo.id, dHash: item.photo.dHash, score: item.analysis.aiScore });
          onPhoto(item);
        } catch (err) {
          if (isQuotaError(err)) { stopReason = stopMessage(done); break; }
          console.error('Analiza a esuat pentru ' + file.name + ':', err);
          failed++;
          let reason = err instanceof Error ? (err.name + ': ' + err.message) : String(err);
          const realFormat = await sniffRealFormat(file);
          if (realFormat) reason += ` [fisier real: ${realFormat}, etichetat "${file.type || file.name}"]`;
          failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        }
        done++;
        onProgress({ done, total: images.length, fileName: file.name, phase: 'analiza' });
      }
    })
  );

  // Grupare serii/duplicate (dHash), PERSISTATA in DB: cea mai buna ramane propusa,
  // restul trec la "review" ca variante de comparat. Comparatia O(n^2) ruleaza
  // intr-un Worker dedicat (hashCompare.worker.ts), procesata in chunk-uri —
  // pentru 1000+ poze, milioane de comparatii sincrone pe firul principal
  // blocau vizibil UI-ul in acest punct al importului.
  onProgress({ done, total: images.length, fileName: '', phase: 'grupare' });
  const groups = new Map<string, string>();
  const { groups: groupResults } = await groupPhotosByHash(
    hashes.map(h => ({ id: h.id, hash: h.dHash, score: h.score }))
  );
  for (const g of groupResults) {
    for (const memberId of g.memberIds) {
      groups.set(memberId, g.groupId);
      const patch: Partial<PhotoRecord> = { groupId: g.groupId };
      if (memberId !== g.bestId) {
        const rec = await db.photos.get(memberId);
        if (rec && rec.status === 'selected') patch.status = 'review';
      }
      await db.photos.update(memberId, patch);
    }
  }

  // Fara acest avertisment, un import in care TOATE pozele esueaza la decodare
  // (fisier corupt, format neasteptat, poza cu 0 fete detectabile pe un device
  // fara accelerare etc.) se termina complet in tacere: bara de progres ajunge
  // la 100%, dispare, si utilizatorul ramane cu ecranul gol, fara nicio pista.
  // Includem motivul real (nume + mesaj eroare) — fara el, "format neasteptat"
  // e un mesaj generic care nu ajuta la diagnosticare de la distanta.
  const topReasons = [...failureReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, n]) => `${reason} (x${n})`)
    .join(' · ');
  const failureWarning = failed > 0
    ? (failed === images.length
        ? `Niciuna dintre cele ${images.length} poze nu a putut fi procesata.`
        : `${failed} din ${images.length} poze nu au putut fi procesate — restul au fost adaugate.`)
      + (topReasons ? ` Motiv: ${topReasons}` : '')
    : undefined;
  onProgress({ done, total: images.length, fileName: '', phase: 'finalizat', warning: stopReason ?? failureWarning });
  return groups;
}
