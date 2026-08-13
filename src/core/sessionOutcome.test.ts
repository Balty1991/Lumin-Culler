import { describe, expect, it } from 'vitest';
import { summarizeSession } from './sessionOutcome';

const base = { imported: 400, autoDecided: 353, seriesFound: 18, durationMs: 300_000 };

describe('summarizeSession', () => {
  it('spune cate raman de verificat, nu doar cate au intrat', () => {
    const out = summarizeSession(base)!;
    expect(out.leftToReview).toBe(47);
    expect(out.handledShare).toBeCloseTo(353 / 400);
  });

  it('nu raporteaza nimic pentru un lot gol', () => {
    expect(summarizeSession({ ...base, imported: 0 })).toBeNull();
    expect(summarizeSession({ ...base, imported: -3 })).toBeNull();
  });

  it('nu poate anunta mai multe decise decat aduse', () => {
    // cele doua cifre vin din surse diferite (contorul importului si statusurile
    // recitite din baza); un "413 din 412" ar distruge increderea in tot ecranul
    const out = summarizeSession({ ...base, imported: 412, autoDecided: 413 })!;
    expect(out.autoDecided).toBe(412);
    expect(out.leftToReview).toBe(0);
    expect(out.handledShare).toBe(1);
  });

  it('trateaza cazul in care nimic n-a fost decis automat', () => {
    const out = summarizeSession({ ...base, autoDecided: 0 })!;
    expect(out.leftToReview).toBe(400);
    expect(out.handledShare).toBe(0);
  });

  it('nu lasa cifre negative sa ajunga pe ecran', () => {
    const out = summarizeSession({ imported: 10, autoDecided: -5, seriesFound: -2, durationMs: -1 })!;
    expect(out.autoDecided).toBe(0);
    expect(out.seriesFound).toBe(0);
    expect(out.durationMs).toBe(0);
  });
});
