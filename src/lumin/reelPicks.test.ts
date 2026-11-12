import { describe, expect, it } from 'vitest';
import { reelPicks } from './reelPicks';
import type { PhotoView } from '../state/store';

const DAY = 86_400_000;
const now = new Date(2026, 10, 12, 12).getTime();
const p = (id: string, ago: number, extra: Partial<PhotoView> = {}) =>
  ({ id, status: 'selected', importedAt: now - ago * DAY, capturedAt: now - ago * DAY, aiScore: 60, faceCount: 1, bestSmile: 0.5, ...extra }) as unknown as PhotoView;

describe('Reel / TikTok', () => {
  it('cele mai bune din săptămână, câte una din serie, în ordinea timpului', () => {
    const photos = [p('a', 1, { aiScore: 90 }), p('b', 2), p('c', 3, { groupId: 'g', aiScore: 95 }), p('d', 3, { groupId: 'g', aiScore: 94 }),
      p('e', 4), p('f', 5), p('veche', 40, { aiScore: 99 }), p('nu', 1, { status: 'rejected', aiScore: 99 })];
    const ids = reelPicks(photos, 12, now);
    expect(ids).not.toContain('veche');
    expect(ids).not.toContain('nu');
    expect(ids.filter(x => x === 'c' || x === 'd')).toHaveLength(1);
    expect(ids[ids.length - 1]).toBe('a');
  });
});
