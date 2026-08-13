import { describe, expect, it } from 'vitest';
import { findHabits, MIN_BUCKET, MIN_TOTAL, MIN_DEVIATION, MAX_FINDINGS, type HabitInput } from './habits';

/** N decizii identice. `hour` e ora LOCALA dorita pentru captura. */
function rows(n: number, kept: boolean, extra: Partial<HabitInput> = {}): HabitInput[] {
  return Array.from({ length: n }, () => ({ kept, ...extra }));
}
function atHour(hour: number): number {
  const d = new Date(2026, 0, 15, hour, 30, 0);
  return d.getTime();
}
/** Fundal neutru: multe decizii, jumatate pastrate, fara nimic distinctiv. */
const NEUTRAL = [...rows(40, true), ...rows(40, false)];

describe('findHabits', () => {
  it('nu spune nimic pe prea putine decizii', () => {
    expect(findHabits(rows(MIN_TOTAL - 1, true))).toEqual([]);
    expect(findHabits([])).toEqual([]);
  });

  it('nu inventeaza tipare acolo unde nu exista', () => {
    expect(findHabits(NEUTRAL)).toEqual([]);
  });

  it('gaseste ora din zi la care chiar pastrezi mai mult', () => {
    const found = findHabits([
      ...NEUTRAL,
      ...rows(20, true, { capturedAt: atHour(19) }) // seara: pastrezi tot
    ]);
    const time = found.find(h => h.kind === 'time')!;
    expect(time.key).toBe('evening');
    expect(time.keepRate).toBe(1);
    expect(time.keepRate).toBeGreaterThan(time.baseline);
  });

  it('gaseste si subiectul pe care il arunci aproape mereu', () => {
    const found = findHabits([...NEUTRAL, ...rows(20, false, { sceneTags: ['food'] })]);
    const subject = found.find(h => h.kind === 'subject')!;
    expect(subject.key).toBe('food');
    expect(subject.keepRate).toBe(0);
  });

  it('desparte focalele dupa echivalentul 35mm', () => {
    const found = findHabits([...NEUTRAL, ...rows(20, true, { focalLength35mm: 85 })]);
    expect(found.find(h => h.kind === 'focal')!.key).toBe('tele');
    const wide = findHabits([...NEUTRAL, ...rows(20, false, { focalLength35mm: 16 })]);
    expect(wide.find(h => h.kind === 'focal')!.key).toBe('wide');
  });

  it('ignora o grupa prea mica pentru a insemna ceva, oricat de extrema ar parea', () => {
    // toate aruncate, dar sub pragul minim de grupa
    const found = findHabits([...NEUTRAL, ...rows(MIN_BUCKET - 1, false, { sceneTags: ['receipt'] })]);
    expect(found.find(h => h.kind === 'subject')).toBeUndefined();
  });

  it('ignora o abatere prea mica fata de rata ta generala', () => {
    // fundalul e 50%; o grupa la ~55% nu e o descoperire
    const found = findHabits([
      ...NEUTRAL,
      ...rows(11, true, { sceneTags: ['tree'] }), ...rows(9, false, { sceneTags: ['tree'] })
    ]);
    expect(Math.abs(0.55 - 0.5)).toBeLessThan(MIN_DEVIATION);
    expect(found.find(h => h.kind === 'subject')).toBeUndefined();
  });

  it('raporteaza o singura constatare per categorie — cea mai puternica', () => {
    const found = findHabits([
      ...NEUTRAL,
      ...rows(20, false, { sceneTags: ['food'] }),          // abatere -0.5
      ...rows(20, true, { sceneTags: ['dog'] })             // abatere +0.5, dar dupa amestecare
    ]);
    expect(found.filter(h => h.kind === 'subject')).toHaveLength(1);
  });

  it('nu debiteaza o lista lunga de "descoperiri"', () => {
    const found = findHabits([
      ...NEUTRAL,
      ...rows(20, true, { capturedAt: atHour(19), sceneTags: ['dog'], focalLength35mm: 85 })
    ]);
    expect(found.length).toBeLessThanOrEqual(MAX_FINDINGS);
  });

  it('pune prima constatarea cea mai puternica', () => {
    const found = findHabits([
      ...NEUTRAL,
      ...rows(20, true, { capturedAt: atHour(19) }),                     // +0.5
      ...rows(20, false, { focalLength35mm: 16 }), ...rows(20, true, { focalLength35mm: 16 }) // ~0
    ]);
    expect(found[0].kind).toBe('time');
  });
});
