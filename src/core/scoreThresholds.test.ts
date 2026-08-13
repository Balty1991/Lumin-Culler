import { describe, expect, it } from 'vitest';
import {
  deriveThresholds, FIXED_THRESHOLDS, MIN_SCORES_FOR_ADAPTATION,
  SELECT_THRESHOLD, REJECT_THRESHOLD
} from './scoreThresholds';

/** N scoruri, sortate crescator, produse de `gen`. */
function library(n: number, gen: (i: number) => number): number[] {
  return Array.from({ length: n }, (_, i) => gen(i)).sort((a, b) => a - b);
}

/** Biblioteca raspandita uniform pe tot intervalul — cazul sanatos. */
const normal = library(400, i => Math.round((i / 399) * 100));

describe('deriveThresholds', () => {
  it('nu adapteaza nimic pe o biblioteca prea mica pentru a fi de incredere', () => {
    const mica = library(MIN_SCORES_FOR_ADAPTATION - 1, () => 10); // degenerata, dar prea mica
    expect(deriveThresholds(mica)).toEqual(FIXED_THRESHOLDS);
    expect(deriveThresholds([])).toEqual(FIXED_THRESHOLDS);
  });

  it('lasa pragurile fixe complet neatinse cand produc deja un rezultat rezonabil', () => {
    const t = deriveThresholds(normal);
    expect(t.select).toBe(SELECT_THRESHOLD);
    expect(t.reject).toBe(REJECT_THRESHOLD);
    expect(t.adapted).toBe(false);
  });

  it('coboara pragul de selectie cand ALTFEL nu s-ar propune nimic', () => {
    // o sesiune intreaga in interior, seara: nimic nu trece de 65
    const intuneric = library(400, i => 20 + Math.round((i / 399) * 30)); // 20..50
    const t = deriveThresholds(intuneric);
    expect(t.select).toBeLessThan(SELECT_THRESHOLD);
    expect(t.adapted).toBe(true);
  });

  it('urca pragul de selectie cand ALTFEL s-ar propune aproape tot', () => {
    const vacanta = library(400, i => 70 + Math.round((i / 399) * 25)); // 70..95
    expect(deriveThresholds(vacanta).select).toBeGreaterThan(SELECT_THRESHOLD);
  });

  it('urca pragul de respingere cand nimic nu s-ar respinge, si il coboara cand s-ar respinge aproape tot', () => {
    const totBun = library(400, i => 70 + Math.round((i / 399) * 25));
    expect(deriveThresholds(totBun).reject).toBeGreaterThan(REJECT_THRESHOLD);

    const totSlab = library(400, i => Math.round((i / 399) * 30)); // 0..30
    expect(deriveThresholds(totSlab).reject).toBeLessThan(REJECT_THRESHOLD);
  });

  it('nu depaseste niciodata banda ingusta din jurul valorilor fixe, oricat de degenerata ar fi biblioteca', () => {
    for (const scores of [
      library(400, () => 0),    // absolut tot la zero
      library(400, () => 100),  // absolut tot la maxim
      library(400, () => 50),   // tot exact pe prag
      library(400, i => (i < 200 ? 0 : 100)) // doua varfuri, nimic la mijloc
    ]) {
      const t = deriveThresholds(scores);
      expect(t.select).toBeGreaterThanOrEqual(55);
      expect(t.select).toBeLessThanOrEqual(78);
      expect(t.reject).toBeGreaterThanOrEqual(22);
      expect(t.reject).toBeLessThanOrEqual(45);
    }
  });

  it('nu lasa niciodata zona de revizuire sa dispara — pragurile nu se pot incrucisa', () => {
    for (const scores of [
      library(400, () => 0), library(400, () => 100), library(400, () => 50),
      library(400, i => (i < 200 ? 0 : 100)), normal,
      library(400, i => 20 + Math.round((i / 399) * 30))
    ]) {
      const t = deriveThresholds(scores);
      expect(t.reject).toBeLessThan(t.select);
    }
  });

  it('o biblioteca de poze excelente NU incepe sa respinga o cota doar ca sa umple o tinta', () => {
    // Distributie buna, dar nu degenerata: 12% sub 35 si 30% peste 65 — ambele
    // in banda sanatoasa, deci nimic nu are voie sa se miste.
    const buna = library(500, i => (i < 60 ? 20 : i < 350 ? 50 : 80));
    expect(deriveThresholds(buna)).toEqual(FIXED_THRESHOLDS);
  });
});
