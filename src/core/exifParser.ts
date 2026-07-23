/**
 * core/exifParser.ts
 * Parser EXIF minimal, direct pe octeti (fara librarie externa — canvas/
 * createImageBitmap nu expun deloc EXIF, doar aplica orientarea automat).
 * Extrage DOAR campurile relevante pentru scorare (ISO, diafragma, timp de
 * expunere, focala) din segmentul APP1/Exif standard JPEG: SOI -> markere ->
 * APP1 "Exif\0\0" -> header TIFF (byte-order + magic) -> IFD0 -> pointer catre
 * ExifIFD -> tag-urile cautate. Poze fara acest segment (PNG/WebP, sau JPEG
 * fara EXIF) => toate campurile absente, nu eroare.
 */

export interface ExifData {
  iso?: number;
  fNumber?: number;      // f/X (diafragma)
  exposureTime?: number; // secunde (ex. 1/250 -> 0.004)
  focalLength?: number;  // mm
}

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_ISO = 0x8827;
const TAG_FNUMBER = 0x829d;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FOCAL_LENGTH = 0x920a;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;

interface IfdEntry {
  type: number;
  count: number;
  /** Pozitia absoluta (in buffer) a campului de 4 octeti valoare/offset — NU valoarea in sine. */
  valueFieldOffset: number;
}

function readIFD(view: DataView, tiffStart: number, ifdOffset: number, littleEndian: boolean): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return entries;
  const entryCount = view.getUint16(base, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = base + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    entries.set(view.getUint16(entryOffset, littleEndian), {
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      valueFieldOffset: entryOffset + 8
    });
  }
  return entries;
}

/** SHORT/LONG incap in cele 4 octeti "valoare/offset" ai intrarii — citite direct, aliniate la stanga. */
function readInlineInt(view: DataView, entry: IfdEntry, littleEndian: boolean): number | undefined {
  if (entry.type === TYPE_SHORT) return view.getUint16(entry.valueFieldOffset, littleEndian);
  if (entry.type === TYPE_LONG) return view.getUint32(entry.valueFieldOffset, littleEndian);
  return undefined;
}

/** RATIONAL/SRATIONAL (8 octeti) nu incap inline — cele 4 octeti contin un OFFSET (relativ la tiffStart). */
function readRational(view: DataView, tiffStart: number, entry: IfdEntry, littleEndian: boolean): number | undefined {
  if (entry.type !== TYPE_RATIONAL && entry.type !== TYPE_SRATIONAL) return undefined;
  const dataOffset = tiffStart + view.getUint32(entry.valueFieldOffset, littleEndian);
  if (dataOffset + 8 > view.byteLength) return undefined;
  const signed = entry.type === TYPE_SRATIONAL;
  const numerator = signed ? view.getInt32(dataOffset, littleEndian) : view.getUint32(dataOffset, littleEndian);
  const denominator = signed ? view.getInt32(dataOffset + 4, littleEndian) : view.getUint32(dataOffset + 4, littleEndian);
  if (!denominator) return undefined;
  return numerator / denominator;
}

function parseTiff(view: DataView, tiffStart: number): ExifData {
  if (tiffStart + 8 > view.byteLength) return {};
  const byteOrderMark = view.getUint16(tiffStart);
  const littleEndian = byteOrderMark === 0x4949; // "II"
  if (!littleEndian && byteOrderMark !== 0x4d4d) return {}; // nici "II", nici "MM" -> nu e TIFF valid
  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) return {};
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);

  const ifd0 = readIFD(view, tiffStart, ifd0Offset, littleEndian);
  const exifPointer = ifd0.get(TAG_EXIF_IFD_POINTER);
  if (!exifPointer) return {};
  const exifIfdOffset = readInlineInt(view, exifPointer, littleEndian);
  if (exifIfdOffset === undefined) return {};

  const exifIfd = readIFD(view, tiffStart, exifIfdOffset, littleEndian);
  const result: ExifData = {};

  const isoEntry = exifIfd.get(TAG_ISO);
  if (isoEntry) result.iso = readInlineInt(view, isoEntry, littleEndian);

  const fNumberEntry = exifIfd.get(TAG_FNUMBER);
  if (fNumberEntry) result.fNumber = readRational(view, tiffStart, fNumberEntry, littleEndian);

  const exposureEntry = exifIfd.get(TAG_EXPOSURE_TIME);
  if (exposureEntry) result.exposureTime = readRational(view, tiffStart, exposureEntry, littleEndian);

  const focalEntry = exifIfd.get(TAG_FOCAL_LENGTH);
  if (focalEntry) result.focalLength = readRational(view, tiffStart, focalEntry, littleEndian);

  return result;
}

/** Parseaza EXIF dintr-un ArrayBuffer JPEG. Returneaza {} (nu arunca) daca nu exista/nu se poate citi. */
export function parseExif(buffer: ArrayBuffer): ExifData {
  if (buffer.byteLength < 4) return {};
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xffd8) return {}; // nu incepe cu SOI -> nu e JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) break; // structura de markere corupta
    if (marker === 0xffd8 || marker === 0xffd9 || marker === 0xff01 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      offset += 2; // markere fara segment de date (RST0-7, SOI, EOI, TEM)
      if (marker === 0xffd9) break;
      continue;
    }
    if (offset + 4 > view.byteLength) break;
    const segmentLength = view.getUint16(offset + 2);
    if (marker === 0xffda) break; // start-of-scan -> dupa asta vin datele de imagine, nu mai cautam markere
    if (marker === 0xffe1) {
      const segStart = offset + 4;
      if (segStart + 6 <= view.byteLength &&
        view.getUint8(segStart) === 0x45 && view.getUint8(segStart + 1) === 0x78 &&
        view.getUint8(segStart + 2) === 0x69 && view.getUint8(segStart + 3) === 0x66 &&
        view.getUint8(segStart + 4) === 0 && view.getUint8(segStart + 5) === 0) {
        return parseTiff(view, segStart + 6);
      }
    }
    offset += 2 + segmentLength;
  }
  return {};
}
