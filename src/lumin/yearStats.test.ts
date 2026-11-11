import { describe, it, expect } from 'vitest';
import { yearSeason, yearStats } from './yearStats';
import type { PhotoView } from '../state/store';

const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'selected' } as unknown as PhotoView;
const p = (id: string, month: number, extra: Partial<PhotoView> = {}): PhotoView => ({ ...base, id, capturedAt: new Date(2026, month, 5, 12).getTime(), ...extra } as PhotoView);

describe('anul tău în poze', () => {
  const photos = [
    ...Array.from({ length: 14 }, (_, i) => p(`iul${i}`, 6, { personNames: ['Mia'], aiScore: 60 + i })),
    ...Array.from({ length: 6 }, (_, i) => p(`mar${i}`, 2, { aiScore: 40 + i, status: i < 3 ? 'selected' : 'rejected' })),
    p('dec', 11, { aiScore: 99 }), p('vechi', 0, { capturedAt: new Date(2025, 0, 1).getTime() })
  ];
  it('numără anul și alege cele mai bune cadre din luni diferite', () => {
    const s = yearStats(photos, 2026)!;
    expect(s).toMatchObject({ total: 21, kept: 18, topMonth: 6, topPerson: 'Mia' });
    expect(s.best.map(x => x.id)).toEqual(['dec', 'iul13', 'mar2']);
  });
  it('tace pentru un an cu prea puține poze', () => {
    expect(yearStats(photos, 2025)).toBeNull();
  });
  it('se arată singur doar la sfârșit și început de an', () => {
    expect(yearSeason(new Date(2026, 11, 20).getTime())).toBe(2026);
    expect(yearSeason(new Date(2027, 0, 10).getTime())).toBe(2026);
    expect(yearSeason(new Date(2026, 5, 1).getTime())).toBeNull();
  });
});

import { albumPages } from './yearBook';
describe('paginile albumului de familie', () => {
  it('împarte luna pe pagini cu așezări diferite, fără o poză rămasă singură la final', () => {
    const n = (k: number) => albumPages(Array.from({ length: k }, (_, i) => i)).map(p => p.length);
    expect(n(1)).toEqual([1]);
    expect(n(4)).toEqual([1, 3]);
    expect(n(5)).toEqual([1, 4]);
    expect(n(9)).toEqual([1, 3, 5]);
    expect(n(12)).toEqual([1, 3, 4, 2, 2]);
    expect(n(12).reduce((a, b) => a + b, 0)).toBe(12);
    expect(n(30).reduce((a, b) => a + b, 0)).toBe(12);
  });
});
