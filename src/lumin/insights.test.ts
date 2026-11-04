import { describe, it, expect } from 'vitest';
import { duelPairs, forgottenPicks, missingInsights, personLinks, photoProfile, profilePeriod, type InsightPhoto } from './insights';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 12).getTime();
let n = 0;
const ph = (daysAgo: number, names: string[] = [], extra: Partial<InsightPhoto & { groupId: string }> = {}) =>
  ({ id: `p${n++}`, capturedAt: NOW - daysAgo * DAY, personNames: names, status: 'review', aiScore: 50, ...extra });

describe('missingInsights', () => {
  it('spune când un om des fotografiat lipsește de mult', () => {
    const photos = [...Array.from({ length: 14 }, (_, i) => ph(60 + i * 3, ['Ami'])), ...Array.from({ length: 5 }, (_, i) => ph(i, ['Tata']))];
    const out = missingInsights(photos, NOW);
    expect(out[0]).toMatchObject({ kind: 'person', name: 'Ami' });
    expect(out[0].days).toBeGreaterThanOrEqual(60);
  });

  it('nu spune nimic pentru oameni rari sau văzuți recent', () => {
    const photos = [...Array.from({ length: 14 }, (_, i) => ph(i, ['Ami'])), ...Array.from({ length: 3 }, (_, i) => ph(100 + i, ['Rar']))];
    expect(missingInsights(photos, NOW)).toEqual([]);
  });

  it('observă doi oameni care nu mai apar împreună', () => {
    const photos = [
      ...Array.from({ length: 6 }, (_, i) => ph(90 + i, ['Ami', 'Tata'])),
      ...Array.from({ length: 10 }, (_, i) => ph(i, ['Ami'])),
      ...Array.from({ length: 10 }, (_, i) => ph(i + 1, ['Tata']))
    ];
    const out = missingInsights(photos, NOW);
    expect(out.some(i => i.kind === 'pair')).toBe(true);
  });
});

describe('photoProfile', () => {
  it('numără, alege cea mai bună poză și tipul de fotograf', () => {
    const from = NOW - 30 * DAY;
    const photos = Array.from({ length: 20 }, (_, i) => ph(i, ['Ami'], { status: i < 10 ? 'selected' : 'rejected', aiScore: i === 3 ? 99 : 50, faceCount: 1 }));
    const p = photoProfile(photos, from, NOW + 1);
    expect(p.total).toBe(20);
    expect(p.kept).toBe(10);
    expect(p.keepRate).toBe(50);
    expect(p.bestId).toBe(photos[3].id);
    expect(p.archetype).toBe('family');
    expect(p.people[0]).toEqual({ name: 'Ami', count: 10 });
  });

  it('luna arătată: cea trecută la început de lună', () => {
    const { from, to } = profilePeriod(new Date(2026, 10, 4).getTime());
    expect(new Date(from).getMonth()).toBe(9);
    expect(new Date(to).getMonth()).toBe(10);
  });
});

describe('duelPairs', () => {
  it('face perechi din serii, cele două mai bune', () => {
    const photos = [
      ph(1, [], { groupId: 'g1', aiScore: 90 }), ph(1, [], { groupId: 'g1', aiScore: 80 }), ph(1, [], { groupId: 'g1', aiScore: 10 }),
      ph(2, [], { groupId: 'g2', aiScore: 70 }), ph(2, [], { groupId: 'g2', aiScore: 60, status: 'rejected' })
    ];
    const pairs = duelPairs(photos);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map(p => p.aiScore).sort()).toEqual([80, 90]);
  });
});

describe('forgottenPicks și personLinks', () => {
  it('alege poze vechi, frumoase, din luni diferite, fără cele văzute', () => {
    const photos = [ph(400, [], { aiScore: 90 }), ph(401, [], { aiScore: 91 }), ph(800, [], { aiScore: 80 }), ph(10, [], { aiScore: 99 }), ph(1200, [], { aiScore: 40 })];
    const out = forgottenPicks(photos, new Set([photos[2].id]), NOW);
    expect(out.map(p => p.id)).not.toContain(photos[2].id);
    expect(out.map(p => p.id)).not.toContain(photos[3].id);
    expect(out.map(p => p.id)).not.toContain(photos[4].id);
    expect(out).toHaveLength(1);
  });

  it('numără pozele împreună', () => {
    const links = personLinks([{ name: 'A', photoIds: ['1', '2', '3'] }, { name: 'B', photoIds: ['2', '3'] }, { name: 'C', photoIds: ['9'] }]);
    expect(links).toEqual([{ a: 'A', b: 'B', ids: ['2', '3'] }]);
  });
});
