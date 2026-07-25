/**
 * core/rawDecoder.ts
 * Decodare fisiere RAW de aparat foto (CR2/CR3/NEF/ARW/DNG/RAF/ORF/RW2/...) direct
 * in browser, via libraw-wasm (LibRaw compilat in WebAssembly, ruleaza intr-un
 * Worker propriu). Ramanem un PWA static — fara build nativ, fara instalare
 * separata, functioneaza si pe telefon (Android/Brave), la fel ca restul aplicatiei.
 *
 * Strategie pe 2 cai, pentru viteza: preview-ul JPEG deja incorporat in fisierul
 * RAW (generat de aparat la momentul capturii) e suficient de mare pe majoritatea
 * aparatelor moderne — il folosim direct daca exista si e suficient de mare.
 * Doar cand lipseste sau e prea mic facem decodare completa (demosaicing), mult
 * mai lenta (secunde, nu milisecunde) dar corecta pentru orice fisier RAW valid.
 */
import LibRaw from 'libraw-wasm';
import { withTimeout } from './workerPool';

const RAW_DECODE_TIMEOUT_MS = 60000;
const PREVIEW_MAX_SIDE = 2048;
/** Sub aceasta latime, preview-ul incorporat e prea mic pentru evaluarea claritatii — decodam complet. */
const MIN_USABLE_THUMB_WIDTH = 1200;

export const RAW_EXTENSIONS = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|pef|ptx|srw|3fr|erf|kdc|dcr|mrw|raw|rwl|iiq|x3f)$/i;

export function isRawFile(file: File): boolean {
  return RAW_EXTENSIONS.test(file.name);
}

export interface RawExifMeta {
  iso?: number;
  fNumber?: number;
  exposureTime?: number;
  focalLength?: number;
  /** Data/ora reala a capturii (din ceasul aparatului), epoch ms — nu data copierii fisierului pe disc. */
  capturedAt?: number;
  make?: string;
  model?: string;
  lensModel?: string;
  software?: string;
  artist?: string;
  focalLength35mm?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
}

export interface RawDecodeResult {
  bitmap: ImageBitmap;
  meta: RawExifMeta;
}

function metaFromLibRaw(m: Awaited<ReturnType<LibRaw['metadata']>>): RawExifMeta {
  if (!m) return {};
  const meta: RawExifMeta = {};
  if (typeof m.iso_speed === 'number' && m.iso_speed > 0) meta.iso = m.iso_speed;
  if (typeof m.aperture === 'number' && m.aperture > 0) meta.fNumber = m.aperture;
  if (typeof m.shutter === 'number' && m.shutter > 0) meta.exposureTime = m.shutter;
  if (typeof m.focal_len === 'number' && m.focal_len > 0) meta.focalLength = m.focal_len;
  // ceasuri de aparat nesetate produc uneori epoch 0/negativ — evident invalid, il ignoram
  const ts = m.timestamp instanceof Date ? m.timestamp.getTime() : NaN;
  if (Number.isFinite(ts) && ts > 0) meta.capturedAt = ts;

  if (m.camera_make) meta.make = m.camera_make;
  if (m.camera_model) meta.model = m.camera_model;
  if (m.artist) meta.artist = m.artist;
  if (m.software) meta.software = m.software;
  if (m.lens?.Lens) meta.lensModel = m.lens.Lens;
  if (typeof m.lens?.FocalLengthIn35mmFormat === 'number' && m.lens.FocalLengthIn35mmFormat > 0) {
    meta.focalLength35mm = m.lens.FocalLengthIn35mmFormat;
  }
  if (m.gps_data?.gpsparsed) {
    const { latitude, longitude, latref, longref } = m.gps_data;
    let lat = latitude[0] + latitude[1] / 60 + latitude[2] / 3600;
    let lon = longitude[0] + longitude[1] / 60 + longitude[2] / 3600;
    if (latref === 'S') lat = -lat;
    if (longref === 'W') lon = -lon;
    meta.gpsLatitude = lat;
    meta.gpsLongitude = lon;
  }
  return meta;
}

/** RGB(A)/8-16 biti -> ImageData RGBA de 8 biti, singurul format acceptat de canvas. */
function toImageData(width: number, height: number, colors: number, bits: number, data: Uint8Array | Uint16Array): ImageData {
  const out = new Uint8ClampedArray(width * height * 4);
  const shift = bits === 16 ? 8 : 0;
  for (let p = 0, i = 0; p < width * height; p++, i += colors) {
    const o = p * 4;
    if (colors >= 3) {
      out[o] = data[i] >> shift;
      out[o + 1] = data[i + 1] >> shift;
      out[o + 2] = data[i + 2] >> shift;
    } else {
      const v = data[i] >> shift;
      out[o] = v; out[o + 1] = v; out[o + 2] = v;
    }
    out[o + 3] = 255;
  }
  return new ImageData(out, width, height);
}

async function bitmapFromImageData(imageData: ImageData): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions);
}

export async function decodeRawFile(file: File): Promise<RawDecodeResult> {
  const raw = new LibRaw();
  try {
    return await withTimeout(decode(raw, file), RAW_DECODE_TIMEOUT_MS, 'Decodarea RAW a durat prea mult.');
  } finally {
    raw.dispose();
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Ultima soluţie cand demosaicing-ul complet esueaza (compresie neacceptata de acest
 * build — vezi imageData() mai jos): folosim orice preview incorporat utilizabil,
 * oricat de mic sau de slaba calitate, in loc sa renuntam total la fisier. Aproape
 * orice RAW de aparat contine un asemenea preview (generat pentru afisarea pe ecranul
 * aparatului), chiar si cand rezolutia completa foloseste o compresie nesuportata.
 * Returneaza si eroarea (daca a esuat), ca decode() sa poata construi un mesaj final
 * util pentru diagnosticare de la distanta, in loc sa o inghita tacut.
 */
async function decodeThumbFallback(
  thumb: Awaited<ReturnType<LibRaw['thumbnailData']>>
): Promise<{ bitmap: ImageBitmap } | { error: string }> {
  if (!thumb) return { error: 'niciun preview incorporat gasit' };
  try {
    if (thumb.format === 'jpeg') {
      const blob = new Blob([thumb.data as BlobPart], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions);
      return { bitmap };
    }
    if (thumb.format === 'bitmap') {
      // deja RGB8 decodat de LibRaw (nu necesita niciun codec suplimentar) — 3 canale, 8 biti
      const imageData = toImageData(thumb.width, thumb.height, 3, 8, thumb.data);
      const bitmap = await bitmapFromImageData(imageData);
      return { bitmap };
    }
    return { error: `preview incorporat in format nefolosibil (${thumb.format})` };
  } catch (e) {
    return { error: `preview incorporat corupt: ${errMsg(e)}` };
  }
}

async function decode(raw: LibRaw, file: File): Promise<RawDecodeResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Semnal clar de fisier trunchiat: pe Android, alegerea unei poze RAW direct din
  // Google Photos (in loc de galeria locala a telefonului) poate preda browserului
  // un fisier "doar in cloud" nedescarcat complet — file.size raporteaza dimensiunea
  // reala, dar bytes-ii cititi efectiv sunt mult mai putini. LibRaw esueaza atunci cu
  // erori generice ("unexpected end of file"), imposibil de diagnosticat fara asta.
  if (bytes.length < file.size) {
    throw new Error(
      `Fisierul pare incomplet (${bytes.length} din ${file.size} octeti cititi) — probabil a fost ales direct ` +
      'din Google Photos sau alt serviciu cloud, fara sa fie descarcat complet pe telefon. ' +
      'Descarca poza in galeria telefonului (stocarea locala) si incearca din nou.'
    );
  }
  await raw.open(bytes);

  const [metaRaw, thumbResult] = await Promise.all([
    raw.metadata().catch(() => undefined),
    raw.thumbnailData().then(t => ({ ok: true as const, value: t }), (e: unknown) => ({ ok: false as const, error: errMsg(e) }))
  ]);
  const meta = metaFromLibRaw(metaRaw);
  const thumb = thumbResult.ok ? thumbResult.value : undefined;

  if (thumb && thumb.format === 'jpeg' && thumb.width >= MIN_USABLE_THUMB_WIDTH) {
    const blob = new Blob([thumb.data as BlobPart], { type: 'image/jpeg' });
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions);
      return { bitmap, meta };
    } catch {
      // preview-ul incorporat e corupt/necunoscut — cadem pe decodarea completa mai jos
    }
  }

  // imageData() poate respinge promisiunea (nu doar returna un rezultat gol) atunci cand
  // demosaicing-ul complet esueaza — de ex. o compresie pe care acest build LibRaw-Wasm
  // nu o poate decoda (compresie lossy specifica producatorului, HE*/high-efficiency etc.)
  let imageDataError: string | null = null;
  try {
    const image = await raw.imageData();
    if (image) {
      const imageData = toImageData(image.width, image.height, image.colors, image.bits, image.data);
      const bitmap = await bitmapFromImageData(imageData);
      return { bitmap, meta };
    }
    imageDataError = 'imageData() a returnat un rezultat gol';
  } catch (e) {
    imageDataError = errMsg(e);
  }

  const fallback = await decodeThumbFallback(thumb);
  if ('bitmap' in fallback) return { bitmap: fallback.bitmap, meta };

  // Mesajul complet (nu doar o eticheta generica) — esential pentru diagnosticare
  // de la distanta, fara acces la consola browserului utilizatorului (vezi notice-ul
  // de import: importPipeline.ts include err.message ca atare in "Motiv: ...").
  const thumbError = thumbResult.ok ? fallback.error : `thumbnailData() a esuat: ${thumbResult.error}`;
  throw new Error(`LibRaw nu a putut decodifica imaginea. imageData(): ${imageDataError}. Preview incorporat: ${thumbError}.`);
}
