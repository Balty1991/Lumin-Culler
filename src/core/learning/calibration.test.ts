import { describe, it, expect } from 'vitest';
import {
  computeCalibration, worstBin, MIN_TOTAL, MIN_PER_BIN, MIN_BINS,
  type CalibrationInput
} from './calibration';

/**
 * Calibrarea raspunde la alta intrebare decat acordul: nu "cat de des nimereste
 * motorul", ci "inseamna ceva cifra pe care o arata". Conteaza fiindca
 * pragurile care hotarasc ce se decide singur sunt exprimate in scor — daca
 * scorul e decalibrat, taie in locul gresit.
 */

/** n decizii cu scorul dat, dintre care `pastrate` au fost pastrate de om. */
function lot(scor: number, n: number, pastrate: number): CalibrationInput[] {
  return Array.from({ length: n }, (_, i) => ({ aiScore: scor, userDecision: i < pastrate }));
}

describe('cand nu se spune nimic', () => {
  it('tace sub pragul de decizii', () => {
    expect(computeCalibration(lot(65, MIN_TOTAL - 1, 20))).toBeNull();
  });

  it('tace cand scorurile stau toate gramada', () => {
    // O singura banda populata nu descrie o curba, oricat de multe decizii ar
    // avea: nu se poate sti daca motorul distinge intre 20 si 80.
    expect(computeCalibration(lot(65, 200, 130))).toBeNull();
  });

  it('ignora corectiile scrise inainte sa se retina scorul', () => {
    const faraScor: CalibrationInput[] = Array.from({ length: 200 }, () => ({ userDecision: true }));
    expect(computeCalibration(faraScor)).toBeNull();
  });

  it('sare peste benzile prea sarace ca sa insemne ceva', () => {
    const date = [
      ...lot(15, 20, 2), ...lot(45, 20, 9), ...lot(75, 20, 15),
      ...lot(95, MIN_PER_BIN - 1, 0)   // banda de sus, prea putine
    ];
    const rez = computeCalibration(date)!;
    expect(rez.bins.some(b => b.from === 90)).toBe(false);
    expect(rez.bins.length).toBeGreaterThanOrEqual(MIN_BINS);
  });
});

describe('verdictul', () => {
  it('"bun" cand ce prezice se si intampla', () => {
    const rez = computeCalibration([
      ...lot(15, 40, 6),    // prezis .15, observat .15
      ...lot(45, 40, 18),   // prezis .45, observat .45
      ...lot(75, 40, 30),   // prezis .75, observat .75
      ...lot(95, 40, 38)    // prezis .95, observat .95
    ])!;
    expect(rez.error).toBeLessThan(0.03);
    expect(rez.verdict).toBe('bun');
  });

  it('"prea prudent" cand pastrezi mai mult decat prezice', () => {
    // Cazul care doare in practica: motorul cere verificare manuala pe poze pe
    // care omul le-ar fi pastrat oricum.
    const rez = computeCalibration([
      ...lot(25, 40, 24),   // prezis .25, observat .60
      ...lot(45, 40, 32),   // prezis .45, observat .80
      ...lot(65, 40, 38)    // prezis .65, observat .95
    ])!;
    expect(rez.bias).toBeGreaterThan(0.2);
    expect(rez.verdict).toBe('preaPrudent');
  });

  it('"prea increzator" cand pastrezi mai putin decat prezice', () => {
    const rez = computeCalibration([
      ...lot(55, 40, 8), ...lot(75, 40, 12), ...lot(95, 40, 16)
    ])!;
    expect(rez.bias).toBeLessThan(-0.2);
    expect(rez.verdict).toBe('preaIncrezator');
  });

  it('"imprastiat" cand greseste mult, dar in ambele sensuri', () => {
    // Aici nu exista o corectie simpla de aplicat, si e cinstit sa se spuna.
    const rez = computeCalibration([
      ...lot(15, 40, 28),   // mult peste
      ...lot(55, 40, 22),   // aproape
      ...lot(85, 40, 8)     // mult sub
    ])!;
    expect(rez.error).toBeGreaterThan(0.08);
    expect(Math.abs(rez.bias)).toBeLessThan(0.05);
    expect(rez.verdict).toBe('imprastiat');
  });
});

describe('numerele din spate', () => {
  it('eroarea e ponderata cu cate decizii are fiecare banda', () => {
    // O banda cu 100 de decizii bune nu trebuie anulata de una cu 5 proaste.
    const rez = computeCalibration([
      ...lot(25, 200, 50),        // exact .25, 200 de decizii
      ...lot(55, 40, 22),         // exact .55
      ...lot(85, 5, 0)            // complet gresit, dar doar 5
    ])!;
    expect(rez.error).toBeLessThan(0.06);
  });

  it('banda cea mai gresita e cea numita, nu prima gasita', () => {
    const rez = computeCalibration([
      ...lot(25, 40, 14),   // abatere .10
      ...lot(55, 40, 36),   // abatere .35 — asta
      ...lot(85, 40, 32)    // abatere .05
    ])!;
    const cea = worstBin(rez)!;
    expect(cea.from).toBe(50);
  });

  it('nu numeste nicio banda cand toate sunt in regula', () => {
    const rez = computeCalibration([
      ...lot(15, 40, 6), ...lot(45, 40, 18), ...lot(75, 40, 30)
    ])!;
    expect(worstBin(rez)).toBeNull();
  });

  it('scorul 100 intra in ultima banda, nu intr-a unsprezecea', () => {
    const rez = computeCalibration([
      ...lot(15, 40, 6), ...lot(45, 40, 18), ...lot(100, 40, 40)
    ])!;
    expect(rez.bins[rez.bins.length - 1].from).toBe(90);
    expect(rez.bins).toHaveLength(3);
  });
});
