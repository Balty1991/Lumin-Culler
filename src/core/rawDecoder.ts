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

async function decode(raw: LibRaw, file: File): Promise<RawDecodeResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await raw.open(bytes);

  const [metaRaw, thumb] = await Promise.all([
    raw.metadata().catch(() => undefined),
    raw.thumbnailData().catch(() => undefined)
  ]);
  const meta = metaFromLibRaw(metaRaw);

  if (thumb && thumb.format === 'jpeg' && thumb.width >= MIN_USABLE_THUMB_WIDTH) {
    const blob = new Blob([thumb.data as BlobPart], { type: 'image/jpeg' });
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions);
      return { bitmap, meta };
    } catch {
      // preview-ul incorporat e corupt/necunoscut — cadem pe decodarea completa mai jos
    }
  }

  const image = await raw.imageData();
  if (!image) throw new Error('LibRaw nu a putut decodifica imaginea (format neacceptat de acest build).');
  const imageData = toImageData(image.width, image.height, image.colors, image.bits, image.data);
  const bitmap = await bitmapFromImageData(imageData);
  return { bitmap, meta };
}
