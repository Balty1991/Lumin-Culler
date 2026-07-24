import { describe, expect, it } from 'vitest';
import { parseExif } from './exifParser';

/**
 * Construieste un buffer JPEG minim, valid structural, cu un segment APP1/Exif
 * continand exact 4 tag-uri (ISO, FNumber, ExposureTime, FocalLength) — nu
 * foloseste nicio librarie, ca sa verifice parserul impotriva unei surse
 * independente (nu impotriva propriei sale logici).
 */
function buildJpegWithExif(opts: {
  iso: number;
  fNumber: [number, number];       // numarator, numitor
  exposureTime: [number, number];
  focalLength: [number, number];
  littleEndian?: boolean;
}): ArrayBuffer {
  const le = opts.littleEndian ?? true;
  const TIFF_SIZE = 104;
  const tiff = new Uint8Array(TIFF_SIZE);
  const tv = new DataView(tiff.buffer);

  // header TIFF
  if (le) { tiff[0] = 0x49; tiff[1] = 0x49; } else { tiff[0] = 0x4d; tiff[1] = 0x4d; }
  tv.setUint16(2, 0x002a, le);
  tv.setUint32(4, 8, le); // IFD0 la offset 8

  // IFD0: 1 intrare (ExifIFDPointer -> offset 26)
  tv.setUint16(8, 1, le);
  tv.setUint16(10, 0x8769, le);       // tag
  tv.setUint16(12, 4, le);            // type LONG
  tv.setUint32(14, 1, le);            // count
  tv.setUint32(18, 26, le);           // value = offset catre ExifIFD
  tv.setUint32(22, 0, le);            // next IFD = niciunul

  // ExifIFD la offset 26: 4 intrari
  tv.setUint16(26, 4, le);
  // entry0: ISO (SHORT, inline)
  tv.setUint16(28, 0x8827, le);
  tv.setUint16(30, 3, le); // SHORT
  tv.setUint32(32, 1, le);
  tv.setUint16(36, opts.iso, le); // inline, primii 2 din cei 4 octeti
  // entry1: FNumber (RATIONAL, offset 80)
  tv.setUint16(40, 0x829d, le);
  tv.setUint16(42, 5, le);
  tv.setUint32(44, 1, le);
  tv.setUint32(48, 80, le);
  // entry2: ExposureTime (RATIONAL, offset 88)
  tv.setUint16(52, 0x829a, le);
  tv.setUint16(54, 5, le);
  tv.setUint32(56, 1, le);
  tv.setUint32(60, 88, le);
  // entry3: FocalLength (RATIONAL, offset 96)
  tv.setUint16(64, 0x920a, le);
  tv.setUint16(66, 5, le);
  tv.setUint32(68, 1, le);
  tv.setUint32(72, 96, le);
  // next IFD dupa ExifIFD
  tv.setUint32(76, 0, le);

  // datele RATIONAL
  tv.setUint32(80, opts.fNumber[0], le); tv.setUint32(84, opts.fNumber[1], le);
  tv.setUint32(88, opts.exposureTime[0], le); tv.setUint32(92, opts.exposureTime[1], le);
  tv.setUint32(96, opts.focalLength[0], le); tv.setUint32(100, opts.focalLength[1], le);

  const app1Data = new Uint8Array(2 + 6 + TIFF_SIZE);
  const app1View = new DataView(app1Data.buffer);
  app1View.setUint16(0, app1Data.length, false); // lungimea segmentului e mereu big-endian in JPEG
  app1Data.set([0x45, 0x78, 0x69, 0x66, 0, 0], 2); // "Exif\0\0"
  app1Data.set(tiff, 8);

  const out: number[] = [0xff, 0xd8, 0xff, 0xe1, ...app1Data, 0xff, 0xd9];
  return new Uint8Array(out).buffer;
}

/**
 * Buffer JPEG minim cu un singur tag DateTimeOriginal (ASCII, in ExifIFD) —
 * separat de buildJpegWithExif ca sa nu complice offset-urile RATIONAL deja
 * verificate acolo.
 */
function buildJpegWithDateOriginal(dateStr: string, littleEndian = true): ArrayBuffer {
  const le = littleEndian;
  const strBytes = new TextEncoder().encode(dateStr + '\0');
  const TIFF_SIZE = 44 + strBytes.length;
  const tiff = new Uint8Array(TIFF_SIZE);
  const tv = new DataView(tiff.buffer);

  if (le) { tiff[0] = 0x49; tiff[1] = 0x49; } else { tiff[0] = 0x4d; tiff[1] = 0x4d; }
  tv.setUint16(2, 0x002a, le);
  tv.setUint32(4, 8, le); // IFD0 la offset 8

  // IFD0: 1 intrare (ExifIFDPointer -> offset 26)
  tv.setUint16(8, 1, le);
  tv.setUint16(10, 0x8769, le);
  tv.setUint16(12, 4, le); // LONG
  tv.setUint32(14, 1, le);
  tv.setUint32(18, 26, le);
  tv.setUint32(22, 0, le);

  // ExifIFD la offset 26: 1 intrare (DateTimeOriginal, ASCII, offset la 44)
  tv.setUint16(26, 1, le);
  tv.setUint16(28, 0x9003, le); // tag
  tv.setUint16(30, 2, le);      // type ASCII
  tv.setUint32(32, strBytes.length, le);
  tv.setUint32(36, 44, le);     // offset catre datele ASCII
  tv.setUint32(40, 0, le);      // next IFD

  tiff.set(strBytes, 44);

  const app1Data = new Uint8Array(2 + 6 + TIFF_SIZE);
  const app1View = new DataView(app1Data.buffer);
  app1View.setUint16(0, app1Data.length, false);
  app1Data.set([0x45, 0x78, 0x69, 0x66, 0, 0], 2);
  app1Data.set(tiff, 8);

  const out: number[] = [0xff, 0xd8, 0xff, 0xe1, ...app1Data, 0xff, 0xd9];
  return new Uint8Array(out).buffer;
}

/**
 * Buffer JPEG cu Make/Model (ASCII, IFD0), GPS (LatRef/Lat/LonRef/Lon, IFD GPS
 * separat) si WhiteBalance (SHORT, ExifIFD) — verifica "panoul de informatii
 * extins" (plan 3.2.2): campurile camera/obiectiv si coordonatele GPS.
 * Layout-ul (offset-urile) e calculat manual, dar cu variabile descriptive
 * in loc de literali bruti, ca sa ramana verificabil impotriva specificatiei.
 */
function buildJpegWithExtendedFields(opts: {
  make: string; model: string;
  gpsLat: [number, number][]; gpsLatRef: 'N' | 'S';
  gpsLon: [number, number][]; gpsLonRef: 'E' | 'W';
  whiteBalance: 0 | 1;
}): ArrayBuffer {
  const le = true;
  const IFD0_OFFSET = 8;
  const GPS_IFD_OFFSET = 62;   // 8 + 2 + 4*12 + 4
  const EXIF_IFD_OFFSET = 116; // 62 + 2 + 4*12 + 4
  const EXTRA_DATA_OFFSET = 134; // 116 + 2 + 1*12 + 4
  const makeBytes = new TextEncoder().encode(opts.make + '\0');
  const modelBytes = new TextEncoder().encode(opts.model + '\0');
  const MAKE_OFFSET = EXTRA_DATA_OFFSET;
  const MODEL_OFFSET = MAKE_OFFSET + makeBytes.length;
  const LAT_OFFSET = MODEL_OFFSET + modelBytes.length;
  const LON_OFFSET = LAT_OFFSET + 24;
  const TIFF_SIZE = LON_OFFSET + 24;

  const tiff = new Uint8Array(TIFF_SIZE);
  const tv = new DataView(tiff.buffer);

  tiff[0] = 0x49; tiff[1] = 0x49; // "II" little-endian
  tv.setUint16(2, 0x002a, le);
  tv.setUint32(4, IFD0_OFFSET, le);

  // IFD0: Make, Model, GPS IFD pointer, Exif IFD pointer
  tv.setUint16(IFD0_OFFSET, 4, le);
  tv.setUint16(IFD0_OFFSET + 2, 0x010f, le); tv.setUint16(IFD0_OFFSET + 4, 2, le);
  tv.setUint32(IFD0_OFFSET + 6, makeBytes.length, le); tv.setUint32(IFD0_OFFSET + 10, MAKE_OFFSET, le);
  tv.setUint16(IFD0_OFFSET + 14, 0x0110, le); tv.setUint16(IFD0_OFFSET + 16, 2, le);
  tv.setUint32(IFD0_OFFSET + 18, modelBytes.length, le); tv.setUint32(IFD0_OFFSET + 22, MODEL_OFFSET, le);
  tv.setUint16(IFD0_OFFSET + 26, 0x8825, le); tv.setUint16(IFD0_OFFSET + 28, 4, le);
  tv.setUint32(IFD0_OFFSET + 30, 1, le); tv.setUint32(IFD0_OFFSET + 34, GPS_IFD_OFFSET, le);
  tv.setUint16(IFD0_OFFSET + 38, 0x8769, le); tv.setUint16(IFD0_OFFSET + 40, 4, le);
  tv.setUint32(IFD0_OFFSET + 42, 1, le); tv.setUint32(IFD0_OFFSET + 46, EXIF_IFD_OFFSET, le);
  tv.setUint32(IFD0_OFFSET + 50, 0, le); // next IFD

  // GPS IFD: LatRef, Lat (3 rationals), LonRef, Lon (3 rationals)
  tv.setUint16(GPS_IFD_OFFSET, 4, le);
  tv.setUint16(GPS_IFD_OFFSET + 2, 0x0001, le); tv.setUint16(GPS_IFD_OFFSET + 4, 2, le);
  tv.setUint32(GPS_IFD_OFFSET + 6, 2, le);
  tiff[GPS_IFD_OFFSET + 10] = opts.gpsLatRef.charCodeAt(0);
  tv.setUint16(GPS_IFD_OFFSET + 14, 0x0002, le); tv.setUint16(GPS_IFD_OFFSET + 16, 5, le);
  tv.setUint32(GPS_IFD_OFFSET + 18, 3, le); tv.setUint32(GPS_IFD_OFFSET + 22, LAT_OFFSET, le);
  tv.setUint16(GPS_IFD_OFFSET + 26, 0x0003, le); tv.setUint16(GPS_IFD_OFFSET + 28, 2, le);
  tv.setUint32(GPS_IFD_OFFSET + 30, 2, le);
  tiff[GPS_IFD_OFFSET + 34] = opts.gpsLonRef.charCodeAt(0);
  tv.setUint16(GPS_IFD_OFFSET + 38, 0x0004, le); tv.setUint16(GPS_IFD_OFFSET + 40, 5, le);
  tv.setUint32(GPS_IFD_OFFSET + 42, 3, le); tv.setUint32(GPS_IFD_OFFSET + 46, LON_OFFSET, le);
  tv.setUint32(GPS_IFD_OFFSET + 50, 0, le); // next IFD

  // ExifIFD: WhiteBalance
  tv.setUint16(EXIF_IFD_OFFSET, 1, le);
  tv.setUint16(EXIF_IFD_OFFSET + 2, 0xa403, le); tv.setUint16(EXIF_IFD_OFFSET + 4, 3, le);
  tv.setUint32(EXIF_IFD_OFFSET + 6, 1, le); tv.setUint16(EXIF_IFD_OFFSET + 10, opts.whiteBalance, le);
  tv.setUint32(EXIF_IFD_OFFSET + 14, 0, le); // next IFD

  // date externe
  tiff.set(makeBytes, MAKE_OFFSET);
  tiff.set(modelBytes, MODEL_OFFSET);
  opts.gpsLat.forEach(([n, d], i) => { tv.setUint32(LAT_OFFSET + i * 8, n, le); tv.setUint32(LAT_OFFSET + i * 8 + 4, d, le); });
  opts.gpsLon.forEach(([n, d], i) => { tv.setUint32(LON_OFFSET + i * 8, n, le); tv.setUint32(LON_OFFSET + i * 8 + 4, d, le); });

  const app1Data = new Uint8Array(2 + 6 + TIFF_SIZE);
  const app1View = new DataView(app1Data.buffer);
  app1View.setUint16(0, app1Data.length, false);
  app1Data.set([0x45, 0x78, 0x69, 0x66, 0, 0], 2);
  app1Data.set(tiff, 8);

  const out: number[] = [0xff, 0xd8, 0xff, 0xe1, ...app1Data, 0xff, 0xd9];
  return new Uint8Array(out).buffer;
}

describe('parseExif — camp extinse (panou de informatii extins)', () => {
  it('extracts Make/Model (IFD0 ASCII)', () => {
    const buf = buildJpegWithExtendedFields({
      make: 'Canon', model: 'EOS R6',
      gpsLat: [[47, 1], [30, 1], [0, 1]], gpsLatRef: 'N',
      gpsLon: [[19, 1], [2, 1], [0, 1]], gpsLonRef: 'E',
      whiteBalance: 0
    });
    const data = parseExif(buf);
    expect(data.make).toBe('Canon');
    expect(data.model).toBe('EOS R6');
  });

  it('converts GPS degrees/minutes/seconds to decimal degrees, respecting N/E as positive', () => {
    const buf = buildJpegWithExtendedFields({
      make: 'X', model: 'Y',
      gpsLat: [[47, 1], [30, 1], [0, 1]], gpsLatRef: 'N',
      gpsLon: [[19, 1], [2, 1], [0, 1]], gpsLonRef: 'E',
      whiteBalance: 0
    });
    const data = parseExif(buf);
    expect(data.gpsLatitude).toBeCloseTo(47.5);
    expect(data.gpsLongitude).toBeCloseTo(19 + 2 / 60);
  });

  it('negates latitude/longitude for S/W hemispheres', () => {
    const buf = buildJpegWithExtendedFields({
      make: 'X', model: 'Y',
      gpsLat: [[33, 1], [0, 1], [0, 1]], gpsLatRef: 'S',
      gpsLon: [[70, 1], [0, 1], [0, 1]], gpsLonRef: 'W',
      whiteBalance: 1
    });
    const data = parseExif(buf);
    expect(data.gpsLatitude).toBeCloseTo(-33);
    expect(data.gpsLongitude).toBeCloseTo(-70);
  });

  it('maps WhiteBalance 0/1 to auto/manual', () => {
    const auto = parseExif(buildJpegWithExtendedFields({
      make: 'X', model: 'Y', gpsLat: [[0, 1], [0, 1], [0, 1]], gpsLatRef: 'N',
      gpsLon: [[0, 1], [0, 1], [0, 1]], gpsLonRef: 'E', whiteBalance: 0
    }));
    const manual = parseExif(buildJpegWithExtendedFields({
      make: 'X', model: 'Y', gpsLat: [[0, 1], [0, 1], [0, 1]], gpsLatRef: 'N',
      gpsLon: [[0, 1], [0, 1], [0, 1]], gpsLonRef: 'E', whiteBalance: 1
    }));
    expect(auto.whiteBalance).toBe('auto');
    expect(manual.whiteBalance).toBe('manual');
  });
});

describe('parseExif', () => {
  it('extracts ISO, FNumber, ExposureTime, FocalLength (little-endian)', () => {
    const buf = buildJpegWithExif({ iso: 400, fNumber: [28, 10], exposureTime: [1, 250], focalLength: [50, 1] });
    const data = parseExif(buf);
    expect(data.iso).toBe(400);
    expect(data.fNumber).toBeCloseTo(2.8);
    expect(data.exposureTime).toBeCloseTo(1 / 250);
    expect(data.focalLength).toBe(50);
  });

  it('extracts the same fields with big-endian TIFF byte order', () => {
    const buf = buildJpegWithExif({ iso: 1600, fNumber: [40, 10], exposureTime: [1, 60], focalLength: [85, 1], littleEndian: false });
    const data = parseExif(buf);
    expect(data.iso).toBe(1600);
    expect(data.fNumber).toBeCloseTo(4.0);
    expect(data.exposureTime).toBeCloseTo(1 / 60);
    expect(data.focalLength).toBe(85);
  });

  it('returns {} for a non-JPEG buffer (no SOI marker)', () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer; // PNG signature
    expect(parseExif(buf)).toEqual({});
  });

  it('returns {} for a JPEG with no APP1/Exif segment', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer; // SOI + EOI, nimic altceva
    expect(parseExif(buf)).toEqual({});
  });

  it('does not throw on a truncated/corrupt buffer', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff]).buffer; // APP1 declarat dar taiat
    expect(() => parseExif(buf)).not.toThrow();
    expect(parseExif(buf)).toEqual({});
  });

  it('handles a zero denominator gracefully (no division producing Infinity)', () => {
    const buf = buildJpegWithExif({ iso: 100, fNumber: [0, 0], exposureTime: [1, 250], focalLength: [50, 1] });
    const data = parseExif(buf);
    expect(data.fNumber).toBeUndefined();
    expect(data.exposureTime).toBeCloseTo(1 / 250);
  });

  it('extracts DateTimeOriginal (capturedAt) as local time epoch ms', () => {
    const buf = buildJpegWithDateOriginal('2024:07:15 14:30:00');
    const data = parseExif(buf);
    expect(data.capturedAt).toBe(new Date(2024, 6, 15, 14, 30, 0).getTime());
  });

  it('extracts DateTimeOriginal with big-endian TIFF byte order', () => {
    const buf = buildJpegWithDateOriginal('2023:01:02 03:04:05', false);
    const data = parseExif(buf);
    expect(data.capturedAt).toBe(new Date(2023, 0, 2, 3, 4, 5).getTime());
  });

  it('returns capturedAt undefined for a malformed date string', () => {
    const buf = buildJpegWithDateOriginal('not-a-date');
    const data = parseExif(buf);
    expect(data.capturedAt).toBeUndefined();
  });
});
