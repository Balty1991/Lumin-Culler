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
