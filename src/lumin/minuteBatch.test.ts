import { describe, expect, it } from 'vitest';
import { minuteBatch } from './minuteBatch';
import type { PhotoView } from '../state/store';

const day = 86_400_000;
const now = new Date(2026, 10, 12, 12).getTime();
const p = (id: string, ago: number, status = 'review', extra: Partial<PhotoView> = {}) =>
  ({ id, status, importedAt: now - ago * day, capturedAt: now - ago * day, ...extra }) as unknown as PhotoView;

describe('un minut azi', () => {
  it('doar pozele vechi nehotărâte, cele mai noi întâi, cel mult 10', () => {
    const photos = [p('azi', 0), p('ieri', 1), p('alaltaieri', 2), p('pastrata', 3, 'selected'), p('bon', 4, 'review', { aside: 'document' }),
      ...Array.from({ length: 12 }, (_, i) => p(`v${i}`, 10 + i))];
    const r = minuteBatch(photos, now);
    expect(r.ids[0]).toBe('ieri');
    expect(r.ids).toHaveLength(10);
    expect(r.ids).not.toContain('azi');
    expect(r.ids).not.toContain('pastrata');
    expect(r.ids).not.toContain('bon');
    expect(r.left).toBe(14);
  });
});
