import { describe, it, expect } from 'vitest';
import { buildStories } from './stories';
import type { PhotoView } from '../state/store';

const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'selected' } as unknown as PhotoView;
const p = (id: string, extra: Partial<PhotoView>): PhotoView => ({ ...base, id, ...extra } as PhotoView);
const now = new Date(2026, 10, 11, 20, 0).getTime();
const today = (h: number) => new Date(2026, 10, 11, h, 0).getTime();

describe('poveștile de pe Azi', () => {
  const photos = [
    p('a', { capturedAt: today(9), aiScore: 60 }),
    p('b', { capturedAt: today(12), aiScore: 90 }),
    p('c', { capturedAt: today(15), status: 'review' }),
    p('bon', { capturedAt: today(16), aside: 'document' })
  ];
  it('ritualul zilei e primul când ai cel puțin trei poze de azi', () => {
    const s = buildStories(photos, now)[0];
    expect(s.kind).toBe('today');
    expect(s.photos.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(s.cover.id).toBe('b');
  });
  it('dispare după ce l-ai terminat azi și nu apare pentru două poze', () => {
    expect(buildStories(photos, now, true).some(s => s.kind === 'today')).toBe(false);
    expect(buildStories(photos.slice(0, 2), now).some(s => s.kind === 'today')).toBe(false);
  });
});
