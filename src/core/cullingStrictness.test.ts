import { describe, expect, it } from 'vitest';
import { applyStrictness, FIXED_THRESHOLDS, SELECT_THRESHOLD, REJECT_THRESHOLD, type Thresholds } from './scoreThresholds';
import { readCullingStrictness, writeCullingStrictness, isCullingStrictness } from '../state/cullingStrictness';

/**
 * core/cullingStrictness.test.ts
 * Severitatea aleasa de utilizator (functia-titlu a concurentei — vezi
 * comentariul din scoreThresholds.ts).
 *
 * Doua lucruri nu au voie sa se strice niciodata aici, si de-aia sunt testate
 * intai:
 *  - 'balanced' inseamna EXACT comportamentul dinainte ca setarea sa existe.
 *    Cine nu o atinge n-are voie sa vada nicio diferenta;
 *  - banda "de verificat" dintre praguri nu poate disparea, oricat de departe
 *    ar impinge cineva setarea peste o adaptare deja extrema. Daca ar disparea,
 *    aplicatia ar decide singura absolut tot — opusul promisiunii ca tu alegi.
 */
function praguri(select: number, reject: number, adapted = false): Thresholds {
  return { select, reject, adapted };
}

describe('applyStrictness', () => {
  it('"echilibrat" nu schimba absolut nimic', () => {
    expect(applyStrictness(FIXED_THRESHOLDS, 'balanced')).toBe(FIXED_THRESHOLDS);
    const adaptate = praguri(72, 28, true);
    expect(applyStrictness(adaptate, 'balanced')).toBe(adaptate);
  });

  it('"sever" ridica amandoua pragurile — mai greu de pastrat, mai usor de respins', () => {
    const r = applyStrictness(FIXED_THRESHOLDS, 'strict');
    expect(r.select).toBe(SELECT_THRESHOLD + 8);
    expect(r.reject).toBe(REJECT_THRESHOLD + 8);
  });

  it('"ingaduitor" coboara amandoua pragurile', () => {
    const r = applyStrictness(FIXED_THRESHOLDS, 'lax');
    expect(r.select).toBe(SELECT_THRESHOLD - 8);
    expect(r.reject).toBe(REJECT_THRESHOLD - 8);
  });

  it('pastreaza semnalul "s-au adaptat pragurile" — severitatea nu-l inlocuieste', () => {
    // Cele doua raspund la intrebari diferite: adaptarea la "distributia e
    // degenerata?", severitatea la "asa vreau eu". UI-ul explica prima; a doua
    // n-are de ce sa o stearga.
    expect(applyStrictness(praguri(72, 28, true), 'strict').adapted).toBe(true);
    expect(applyStrictness(praguri(65, 35, false), 'lax').adapted).toBe(false);
  });

  it('ramane loc de "de verificat" chiar si peste o adaptare extrema', () => {
    // Adaptarea a impins deja pragurile una spre alta cat a putut; severitatea
    // vine peste. Fara plafonul fata de `select`, respingerea putea urca peste
    // selectie si zona de revizuit disparea.
    for (const nivel of ['lax', 'strict'] as const) {
      for (const [sel, rej] of [[55, 45], [78, 45], [55, 22], [50, 50], [85, 18]]) {
        const r = applyStrictness(praguri(sel, rej, true), nivel);
        expect(r.select - r.reject, `${nivel} pe ${sel}/${rej}`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('nu iese din limitele alegerii utilizatorului, oricat de departe ar fi pragul de baza', () => {
    const sus = applyStrictness(praguri(85, 50), 'strict');
    expect(sus.select).toBeLessThanOrEqual(85);
    const jos = applyStrictness(praguri(50, 18), 'lax');
    expect(jos.select).toBeGreaterThanOrEqual(50);
    expect(jos.reject).toBeGreaterThanOrEqual(18);
  });

  it('cele trei trepte raman in ordine: ingaduitor pastreaza cel mai mult, sever cel mai putin', () => {
    const lax = applyStrictness(FIXED_THRESHOLDS, 'lax');
    const bal = applyStrictness(FIXED_THRESHOLDS, 'balanced');
    const strict = applyStrictness(FIXED_THRESHOLDS, 'strict');
    // Prag de selectie mai mic = mai multe poze trec de el.
    expect(lax.select).toBeLessThan(bal.select);
    expect(bal.select).toBeLessThan(strict.select);
  });
});

describe('pastrarea alegerii', () => {
  it('implicitul e "echilibrat" — adica exact comportamentul dinainte', () => {
    localStorage.clear();
    expect(readCullingStrictness()).toBe('balanced');
  });

  it('alegerea supravietuieste unei reporniri', () => {
    localStorage.clear();
    writeCullingStrictness('strict');
    expect(readCullingStrictness()).toBe('strict');
  });

  it('o valoare necunoscuta in stocare cade pe implicit, nu arunca', () => {
    // Se poate ajunge aici dintr-un backup editat de om sau dintr-o versiune
    // viitoare care ar adauga o a patra treapta.
    localStorage.setItem('lumin-culling-strictness', 'brutal');
    expect(readCullingStrictness()).toBe('balanced');
    localStorage.clear();
  });

  it('isCullingStrictness accepta doar cele trei trepte', () => {
    expect(isCullingStrictness('lax')).toBe(true);
    expect(isCullingStrictness('balanced')).toBe(true);
    expect(isCullingStrictness('strict')).toBe(true);
    expect(isCullingStrictness('')).toBe(false);
    expect(isCullingStrictness(null)).toBe(false);
    expect(isCullingStrictness(2)).toBe(false);
  });
});
