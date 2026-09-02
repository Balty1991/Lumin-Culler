import { describe, expect, it } from 'vitest';
import { medianDecisionSeconds, estimateSecondsSaved, MIN_GAPS } from './decisionPace';

/**
 * core/decisionPace.test.ts
 * Cifra asta ajunge intr-un ecran care cere bani. Deci nu e de ajuns sa fie
 * calculata corect — trebuie sa TACA in toate cazurile in care n-ar fi onesta.
 * Aproape toate testele de mai jos verifica tocmai tacerea.
 */

/** `n` decizii la exact `gapMs` una de alta. */
function ritm(n: number, gapMs: number, start = 1_700_000_000_000): number[] {
  return Array.from({ length: n }, (_, i) => start + i * gapMs);
}

describe('medianDecisionSeconds', () => {
  it('da ritmul real cand exista destule decizii consecutive', () => {
    expect(medianDecisionSeconds(ritm(MIN_GAPS + 1, 2400))).toBe(2.4);
  });

  it('tace sub pragul de intervale — un ritm din cinci decizii nu e un ritm', () => {
    expect(medianDecisionSeconds(ritm(MIN_GAPS, 2000))).toBeNull(); // n decizii = n-1 intervale
    expect(medianDecisionSeconds(ritm(MIN_GAPS + 1, 2000))).not.toBeNull();
    expect(medianDecisionSeconds([])).toBeNull();
    expect(medianDecisionSeconds([1_700_000_000_000])).toBeNull();
  });

  it('nu numara pauzele: cine lasa telefonul din mana nu "decide" doua ore', () => {
    // 30 de decizii rapide, apoi o pauza de 3 ore, apoi inca 30.
    const parteaUnu = ritm(30, 2000);
    const parteaDoi = ritm(30, 2000, parteaUnu[29] + 3 * 3600_000);
    expect(medianDecisionSeconds([...parteaUnu, ...parteaDoi])).toBe(2);
  });

  it('mediana, nu media — o singura pauza de gandire n-are voie sa mute cifra', () => {
    const t = ritm(MIN_GAPS + 1, 2000);
    // Un singur interval de 55s, sub pragul de pauza deci pastrat, dar enorm
    // fata de restul. Media ar sari la ~4,5s; mediana ramane 2.
    const cuPauza = [...t, t[t.length - 1] + 55_000, t[t.length - 1] + 57_000];
    expect(medianDecisionSeconds(cuPauza)).toBe(2);
  });

  it('ignora intervalele absurd de mici — operatii in masa, nu decizii', () => {
    // 40 de "decizii" la 10ms (o operatie in masa) + 25 reale la 3s.
    const masa = ritm(40, 10);
    const reale = ritm(26, 3000, masa[39] + 3000);
    expect(medianDecisionSeconds([...masa, ...reale])).toBe(3);
  });

  it('nu depinde de ordinea in care primeste momentele', () => {
    const t = ritm(MIN_GAPS + 1, 1500);
    const amestecat = [...t].sort(() => Math.random() - 0.5);
    expect(medianDecisionSeconds(amestecat)).toBe(1.5);
  });

  it('sare peste valori corupte fara sa arunce', () => {
    const t = ritm(MIN_GAPS + 1, 2000);
    expect(medianDecisionSeconds([...t, NaN, Infinity])).toBe(2);
  });
});

describe('estimateSecondsSaved', () => {
  it('inmulteste deciziile automate cu ritmul masurat', () => {
    expect(estimateSecondsSaved(1000, 2.4)).toBe(2400);
  });

  it('tace cand ritmul nu e cunoscut — nu cade pe o valoare "rezonabila"', () => {
    // Exact capcana pe care o interzice regula din sessionOutcome.ts: o
    // constanta plauzibila e tot o cifra inventata.
    expect(estimateSecondsSaved(1000, null)).toBeNull();
  });

  it('tace cand motorul n-a decis nimic singur', () => {
    expect(estimateSecondsSaved(0, 2.4)).toBeNull();
    expect(estimateSecondsSaved(-5, 2.4)).toBeNull();
  });
});
