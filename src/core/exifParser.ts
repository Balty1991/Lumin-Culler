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
  /** Data/ora REALA a capturii (DateTimeOriginal), epoch ms — nu data importului/copierii fisierului. */
  capturedAt?: number;

  // ── "Panou de informatii extins" (plan 3.2.2) — info camera/obiectiv/GPS,
  // dincolo de campurile deja folosite pentru scorare mai sus. Toate optionale:
  // multe aparate/telefoane nu scriu toate aceste tag-uri.
  make?: string;           // producator aparat (ex. "Canon")
  model?: string;          // model aparat (ex. "EOS R6")
  lensModel?: string;
  software?: string;       // aplicatia/firmware-ul care a procesat ultima data fisierul
  artist?: string;
  copyright?: string;
  exposureBias?: number;   // in stops (EV), 0 = fara compensare
  meteringMode?: string;
  flashFired?: boolean;
  whiteBalance?: 'auto' | 'manual';
  focalLength35mm?: number; // echivalent 35mm (util pt. senzori APS-C/MFT, unde focalLength brut e inselator)
  gpsLatitude?: number;    // grade zecimale, negativ = emisfera sudica
  gpsLongitude?: number;   // grade zecimale, negativ = vest
}

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;
const TAG_ISO = 0x8827;
const TAG_FNUMBER = 0x829d;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME = 0x0132; // fallback, in IFD0 (data ultimei modificari, nu a capturii — folosit doar daca DateTimeOriginal lipseste)
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_ARTIST = 0x013b;
const TAG_COPYRIGHT = 0x8298;
const TAG_LENS_MODEL = 0xa434;
const TAG_EXPOSURE_BIAS = 0x9204;
const TAG_METERING_MODE = 0x9207;
const TAG_FLASH = 0x9209;
const TAG_WHITE_BALANCE = 0xa403;
const TAG_FOCAL_LENGTH_35MM = 0xa405;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_ASCII = 2;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;

const METERING_MODES: Record<number, string> = {
  1: 'Medie', 2: 'Centrata', 3: 'Spot', 4: 'Multi-spot', 5: 'Matriceala/Evaluativa', 6: 'Partiala'
};

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

/**
 * ASCII: cele 4 octeti "valoare/offset" contin datele direct DOAR daca incap
 * (count <= 4, inclusiv terminatorul null) — un timestamp EXIF standard
 * ("YYYY:MM:DD HH:MM:SS\0", 20 octeti) depaseste mereu asta, deci practic
 * mereu citim printr-un offset.
 */
function readAscii(view: DataView, tiffStart: number, entry: IfdEntry, littleEndian: boolean): string | undefined {
  if (entry.type !== TYPE_ASCII || entry.count === 0) return undefined;
  const dataStart = entry.count <= 4 ? entry.valueFieldOffset : tiffStart + view.getUint32(entry.valueFieldOffset, littleEndian);
  if (dataStart + entry.count > view.byteLength) return undefined;
  const bytes = new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.count);
  let str = '';
  for (const b of bytes) { if (b === 0) break; str += String.fromCharCode(b); }
  return str;
}

/** "YYYY:MM:DD HH:MM:SS" (ora locala, fara fus orar in EXIF standard) -> epoch ms, sau undefined daca formatul nu se potriveste. */
function parseExifDateTime(s: string): number | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const ts = new Date(y, mo - 1, d, h, mi, se).getTime();
  return Number.isFinite(ts) ? ts : undefined;
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

/** N RATIONAL-uri (8 octeti fiecare) consecutive, incepand la un offset ABSOLUT (nu relativ la intrarea IFD) — folosit pentru coordonatele GPS (grade/minute/secunde, count=3). */
function readRationalArrayAt(view: DataView, dataOffset: number, littleEndian: boolean, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const off = dataOffset + i * 8;
    if (off + 8 > view.byteLength) break;
    const num = view.getUint32(off, littleEndian);
    const den = view.getUint32(off + 4, littleEndian);
    out.push(den ? num / den : 0);
  }
  return out;
}

/** GPSLatitude/GPSLongitude: 3 RATIONAL-uri (grade, minute, secunde) -> grade zecimale. */
function readGpsCoordinate(view: DataView, tiffStart: number, entry: IfdEntry, littleEndian: boolean): number | undefined {
  if (entry.type !== TYPE_RATIONAL || entry.count !== 3) return undefined;
  const dataOffset = tiffStart + view.getUint32(entry.valueFieldOffset, littleEndian);
  const [deg, min, sec] = readRationalArrayAt(view, dataOffset, littleEndian, 3);
  if (deg === undefined) return undefined;
  return deg + (min ?? 0) / 60 + (sec ?? 0) / 3600;
}

function parseTiff(view: DataView, tiffStart: number): ExifData {
  if (tiffStart + 8 > view.byteLength) return {};
  const byteOrderMark = view.getUint16(tiffStart);
  const littleEndian = byteOrderMark === 0x4949; // "II"
  if (!littleEndian && byteOrderMark !== 0x4d4d) return {}; // nici "II", nici "MM" -> nu e TIFF valid
  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) return {};
  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);

  const ifd0 = readIFD(view, tiffStart, ifd0Offset, littleEndian);
  const result: ExifData = {};

  // fallback (data ultimei modificari a fisierului dupa masina aparatului) — suprascris
  // mai jos de DateTimeOriginal daca acesta exista in ExifIFD (mult mai precis: momentul
  // exact al declansarii, nu al eventualei procesari ulterioare in aparat)
  const dateTimeEntry = ifd0.get(TAG_DATE_TIME);
  if (dateTimeEntry) {
    const raw = readAscii(view, tiffStart, dateTimeEntry, littleEndian);
    if (raw) result.capturedAt = parseExifDateTime(raw);
  }

  const makeEntry = ifd0.get(TAG_MAKE);
  if (makeEntry) result.make = readAscii(view, tiffStart, makeEntry, littleEndian)?.trim();
  const modelEntry = ifd0.get(TAG_MODEL);
  if (modelEntry) result.model = readAscii(view, tiffStart, modelEntry, littleEndian)?.trim();
  const softwareEntry = ifd0.get(TAG_SOFTWARE);
  if (softwareEntry) result.software = readAscii(view, tiffStart, softwareEntry, littleEndian)?.trim();
  const artistEntry = ifd0.get(TAG_ARTIST);
  if (artistEntry) result.artist = readAscii(view, tiffStart, artistEntry, littleEndian)?.trim();
  const copyrightEntry = ifd0.get(TAG_COPYRIGHT);
  if (copyrightEntry) result.copyright = readAscii(view, tiffStart, copyrightEntry, littleEndian)?.trim();

  const gpsPointerEntry = ifd0.get(TAG_GPS_IFD_POINTER);
  if (gpsPointerEntry) {
    const gpsIfdOffset = readInlineInt(view, gpsPointerEntry, littleEndian);
    if (gpsIfdOffset !== undefined) {
      const gpsIfd = readIFD(view, tiffStart, gpsIfdOffset, littleEndian);
      const latEntry = gpsIfd.get(TAG_GPS_LAT);
      const lonEntry = gpsIfd.get(TAG_GPS_LON);
      let lat = latEntry ? readGpsCoordinate(view, tiffStart, latEntry, littleEndian) : undefined;
      let lon = lonEntry ? readGpsCoordinate(view, tiffStart, lonEntry, littleEndian) : undefined;
      const latRefEntry = gpsIfd.get(TAG_GPS_LAT_REF);
      const lonRefEntry = gpsIfd.get(TAG_GPS_LON_REF);
      const latRef = latRefEntry ? readAscii(view, tiffStart, latRefEntry, littleEndian) : undefined;
      const lonRef = lonRefEntry ? readAscii(view, tiffStart, lonRefEntry, littleEndian) : undefined;
      if (lat !== undefined && latRef === 'S') lat = -lat;
      if (lon !== undefined && lonRef === 'W') lon = -lon;
      result.gpsLatitude = lat;
      result.gpsLongitude = lon;
    }
  }

  const exifPointer = ifd0.get(TAG_EXIF_IFD_POINTER);
  if (!exifPointer) return result;
  const exifIfdOffset = readInlineInt(view, exifPointer, littleEndian);
  if (exifIfdOffset === undefined) return result;

  const exifIfd = readIFD(view, tiffStart, exifIfdOffset, littleEndian);

  const dateOriginalEntry = exifIfd.get(TAG_DATE_TIME_ORIGINAL);
  if (dateOriginalEntry) {
    const raw = readAscii(view, tiffStart, dateOriginalEntry, littleEndian);
    const parsed = raw ? parseExifDateTime(raw) : undefined;
    if (parsed !== undefined) result.capturedAt = parsed;
  }

  const isoEntry = exifIfd.get(TAG_ISO);
  if (isoEntry) result.iso = readInlineInt(view, isoEntry, littleEndian);

  const fNumberEntry = exifIfd.get(TAG_FNUMBER);
  if (fNumberEntry) result.fNumber = readRational(view, tiffStart, fNumberEntry, littleEndian);

  const exposureEntry = exifIfd.get(TAG_EXPOSURE_TIME);
  if (exposureEntry) result.exposureTime = readRational(view, tiffStart, exposureEntry, littleEndian);

  const focalEntry = exifIfd.get(TAG_FOCAL_LENGTH);
  if (focalEntry) result.focalLength = readRational(view, tiffStart, focalEntry, littleEndian);

  const lensModelEntry = exifIfd.get(TAG_LENS_MODEL);
  if (lensModelEntry) result.lensModel = readAscii(view, tiffStart, lensModelEntry, littleEndian)?.trim();

  const exposureBiasEntry = exifIfd.get(TAG_EXPOSURE_BIAS);
  if (exposureBiasEntry) result.exposureBias = readRational(view, tiffStart, exposureBiasEntry, littleEndian);

  const meteringEntry = exifIfd.get(TAG_METERING_MODE);
  if (meteringEntry) {
    const code = readInlineInt(view, meteringEntry, littleEndian);
    if (code !== undefined) result.meteringMode = METERING_MODES[code];
  }

  const flashEntry = exifIfd.get(TAG_FLASH);
  if (flashEntry) {
    const code = readInlineInt(view, flashEntry, littleEndian);
    if (code !== undefined) result.flashFired = (code & 0x1) !== 0;
  }

  const whiteBalanceEntry = exifIfd.get(TAG_WHITE_BALANCE);
  if (whiteBalanceEntry) {
    const code = readInlineInt(view, whiteBalanceEntry, littleEndian);
    if (code !== undefined) result.whiteBalance = code === 0 ? 'auto' : 'manual';
  }

  const focal35Entry = exifIfd.get(TAG_FOCAL_LENGTH_35MM);
  if (focal35Entry) result.focalLength35mm = readInlineInt(view, focal35Entry, littleEndian);

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
