import { describe, it, expect } from 'vitest';
import { beenHere, firstsOf, meters, yearDays, type MomentPhoto } from './moments';
import { framePicks } from './frameWidget';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 5, 12).getTime();
let n = 0;
const ph = (daysAgo: number, extra: Partial<MomentPhoto & { mediaUri: string; faceCount: number }> = {}) =>
  ({ id: `m${n++}`, capturedAt: NOW - daysAgo * DAY, status: 'selected', aiScore: 60, faceCount: 1, ...extra });

describe('moments', () => {
  it('meters: ~111 km pe un grad de latitudine', () => {
    expect(Math.round(meters(44, 25, 45, 25) / 1000)).toBe(111);
  });

  it('beenHere: poza de azi, lângă una de acum 2 ani din același loc', () => {
    const old = ph(730, { gpsLatitude: 44.4268, gpsLongitude: 26.1025, personNames: ['Ami'] });
    const far = ph(730, { gpsLatitude: 45.0, gpsLongitude: 26.0 });
    const now = ph(0, { gpsLatitude: 44.4269, gpsLongitude: 26.1026 });
    const out = beenHere([old, far, now], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].old.id).toBe(old.id);
    expect(out[0].years).toBe(2);
  });

  it('firstsOf: prima zăpadă și primul tort, în ordinea timpului', () => {
    const a = ph(400, { personNames: ['Ami'], aiDescription: 'a child playing in the snow' });
    const b = ph(300, { personNames: ['Ami'], aiDescription: 'a girl in the snow' });
    const c = ph(200, { personNames: ['Ami'], aiDescription: 'a girl with a birthday cake' });
    const d = ph(100, { personNames: ['Tata'], aiDescription: 'a man on a boat' });
    const e = ph(50, { personNames: ['Ami'], sceneTags: ['horse'] });
    const out = firstsOf([a, b, c, d, e], 'Ami');
    expect(out.map(f => f.key)).toEqual(['snow', 'cake']);
    expect(out[0].photo.id).toBe(a.id);
    // „Nu e bine” pe prima zăpadă: următoarea poză cu zăpadă.
    expect(firstsOf([a, b, c], 'Ami', { snow: [a.id] })[0].photo.id).toBe(b.id);
  });

  it('yearDays: cea mai bună poză pe zi, doar din anul ales', () => {
    const y = new Date(NOW).getFullYear();
    const p1 = { ...ph(1), aiScore: 10 }, p2 = { ...ph(1), aiScore: 90 }, p3 = ph(2), p4 = ph(400);
    const out = yearDays([p1, p2, p3, p4], y);
    expect(out.map(p => p.id)).toEqual([p3.id, p2.id]);
  });

  it('framePicks: poze păstrate cu oameni, una pe lună', () => {
    const out = framePicks([
      ph(10, { mediaUri: 'a', aiScore: 50 }), ph(11, { mediaUri: 'b', aiScore: 80 }),
      ph(60, { mediaUri: 'c' }), ph(90, { mediaUri: 'd', faceCount: 0 }), ph(120, { status: 'rejected', mediaUri: 'e' })
    ]);
    expect(out.map(p => p.mediaUri).sort()).toEqual(['b', 'c']);
  });
});
