import { describe, expect, it } from 'vitest';
import { summarizeAccuracy, MIN_DECISIONS_FOR_ACCURACY, RECENT_WINDOW, type AccuracyInput } from './accuracy';

let clock = 0;
function decision(aiDecision: boolean, userDecision: boolean): AccuracyInput {
  return { aiDecision, userDecision, ts: clock++ };
}
/** N decizii identice. */
function many(n: number, ai: boolean, user: boolean): AccuracyInput[] {
  return Array.from({ length: n }, () => decision(ai, user));
}

describe('summarizeAccuracy', () => {
  it('nu spune nimic pana nu ai judecat destule poze tu insuti', () => {
    expect(summarizeAccuracy([])).toBeNull();
    expect(summarizeAccuracy(many(MIN_DECISIONS_FOR_ACCURACY - 1, true, true))).toBeNull();
    expect(summarizeAccuracy(many(MIN_DECISIONS_FOR_ACCURACY, true, true))).not.toBeNull();
  });

  it('spune cate dintre pozele propuse spre pastrare chiar le-ai pastrat', () => {
    // 20 propuse spre pastrare, 15 pastrate -> 75%
    const s = summarizeAccuracy([...many(15, true, true), ...many(5, true, false)])!;
    expect(s.keepPrecision).toBeCloseTo(0.75);
    expect(s.rejectPrecision).toBeNull(); // n-a pus nimic deoparte
  });

  it('spune separat si cate dintre cele puse deoparte chiar le-ai aruncat', () => {
    const s = summarizeAccuracy([...many(18, false, false), ...many(2, false, true)])!;
    expect(s.rejectPrecision).toBeCloseTo(0.9);
    expect(s.keepPrecision).toBeNull();
  });

  it('poate arata si prost — un indicator care nu poate arata rau nu e indicator', () => {
    const s = summarizeAccuracy(many(20, true, false))!;
    expect(s.keepPrecision).toBe(0);
    expect(s.agreement).toBe(0);
  });

  it('numara doar deciziile TALE, nu toata biblioteca', () => {
    expect(summarizeAccuracy(many(30, true, true))!.total).toBe(30);
  });

  it('nu raporteaza o tendinta pana nu are doua ferestre pline, care NU se suprapun', () => {
    expect(summarizeAccuracy(many(RECENT_WINDOW * 2 - 1, true, true))!.trend).toBeNull();
    expect(summarizeAccuracy(many(RECENT_WINDOW * 2, true, true))!.trend).not.toBeNull();
  });

  it('arata ca s-a adaptat cand acordul recent e mai bun decat cel de la inceput', () => {
    // intai gresit, apoi corect — exact ce ar trebui sa se intample invatand
    const s = summarizeAccuracy([...many(RECENT_WINDOW, true, false), ...many(RECENT_WINDOW, true, true)])!;
    expect(s.trend!.earlier).toBe(0);
    expect(s.trend!.recent).toBe(1);
  });

  it('nu depinde de ordinea in care primeste inregistrarile', () => {
    const rows = [...many(RECENT_WINDOW, true, false), ...many(RECENT_WINDOW, true, true)];
    const shuffled = [...rows].reverse();
    expect(summarizeAccuracy(shuffled)!.trend).toEqual(summarizeAccuracy(rows)!.trend);
  });
});
