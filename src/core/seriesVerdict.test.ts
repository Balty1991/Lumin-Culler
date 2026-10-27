import { describe, expect, it } from 'vitest';
import { seriesVerdict } from './seriesVerdict';

const T = { reject: 35 };

describe('seriesVerdict', () => {
  it('păstrează doar poza cu scorul cel mai mare (seria de sub copac)', () => {
    const out = seriesVerdict([
      { id: 'a', score: 84, status: 'selected' },
      { id: 'b', score: 93, status: 'rejected' },
      { id: 'c', score: 81, status: 'selected' },
      { id: 'd', score: 88, status: 'selected' }
    ], T)!;
    expect(out.keepId).toBe('b');
    expect(Object.fromEntries(out.changes)).toEqual({ a: 'rejected', b: 'selected', c: 'rejected', d: 'rejected' });
  });

  it('două selfie-uri identice: rămâne unul', () => {
    const out = seriesVerdict([
      { id: 's1', score: 77, status: 'selected' },
      { id: 's2', score: 77, status: 'selected' }
    ], T, 's2')!;
    expect(out.keepId).toBe('s2');
    expect(Object.fromEntries(out.changes)).toEqual({ s1: 'rejected' });
  });

  it('nu atinge ce a decis omul', () => {
    const out = seriesVerdict([
      { id: 'a', score: 90, status: 'selected' },
      { id: 'b', score: 70, status: 'selected', aiDecided: false }
    ], T)!;
    expect(out.changes.size).toBe(0);
  });

  it('o serie toată slabă nu dispare: cea mai bună rămâne de verificat', () => {
    const out = seriesVerdict([
      { id: 'a', score: 20, status: 'rejected' },
      { id: 'b', score: 30, status: 'rejected' }
    ], T)!;
    expect(Object.fromEntries(out.changes)).toEqual({ b: 'review' });
  });

  it('o poză singură nu e serie', () => {
    expect(seriesVerdict([{ id: 'a', score: 50, status: 'review' }], T)).toBeNull();
  });
});
