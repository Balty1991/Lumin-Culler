import { describe, expect, it } from 'vitest';
import { findVideoCleanup, type GalleryVideo } from './nativeVideos';

const v = (uri: string, sizeBytes: number, durationMs: number, capturedAt = 0): GalleryVideo =>
  ({ uri, name: uri, sizeBytes, durationMs, capturedAt, width: 1920, height: 1080, folder: 'Camera' });

describe('findVideoCleanup', () => {
  it('copiile aceluiași clip: rămâne cel mai vechi', () => {
    const r = findVideoCleanup([v('a', 1000, 10_000, 5), v('b', 1000, 10_040, 1), v('c', 1000, 30_000)]);
    expect(r.duplicates.map(x => x.uri)).toEqual(['a']);
  });

  it('clipurile de o clipă sunt accidentale, dar nu și cele duble', () => {
    const r = findVideoCleanup([v('a', 10, 800), v('b', 20, 1500), v('c', 30, 2500), v('d', 10, 800, 9)]);
    expect(r.duplicates.map(x => x.uri)).toEqual(['d']);
    expect(r.accidental.map(x => x.uri)).toEqual(['a', 'b']);
  });

  it('cele mari, de la cel mai mare', () => {
    const MB = 1024 * 1024;
    const r = findVideoCleanup([v('a', 60 * MB, 60_000), v('b', 10 * MB, 60_000), v('c', 200 * MB, 120_000)]);
    expect(r.big.map(x => x.uri)).toEqual(['c', 'a']);
  });
});
