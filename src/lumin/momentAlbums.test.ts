import { describe, it, expect } from 'vitest';
import { buildMomentAlbums, onThisDay } from './momentAlbums';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const photo = (id: string, t: number, extra: Record<string, unknown> = {}) =>
  ({ id, capturedAt: t, status: 'review', aiScore: 50, personNames: [], ...extra });

describe('buildMomentAlbums', () => {
  it('groups photos taken close together, names and covers them', () => {
    const albums = buildMomentAlbums([
      photo('a', at(27, 15, 0), { sceneTags: ['Cat'] }),
      photo('b', at(27, 15, 20), { sceneTags: ['Cat'], status: 'selected', aiScore: 90 }),
      photo('c', at(27, 16, 0), { sceneTags: ['Bed'] }),
      photo('far', at(28, 10, 0))
    ], 'ro');
    expect(albums).toHaveLength(1);
    expect(albums[0].cover.id).toBe('b');
    expect(albums[0].subject).toBe('Pisică');
    expect(albums[0].part).toBe('afternoon');
  });
});

describe('onThisDay', () => {
  it('returns photos from the same day in past years', () => {
    const now = new Date(2026, 9, 28, 12).getTime();
    const list = onThisDay([
      photo('old', new Date(2025, 9, 28, 9).getTime()),
      photo('other', new Date(2025, 5, 2).getTime()),
      photo('thisyear', new Date(2026, 9, 28, 9).getTime())
    ], now);
    expect(list).toEqual([{ years: 1, photos: [expect.objectContaining({ id: 'old' })] }]);
  });
});
