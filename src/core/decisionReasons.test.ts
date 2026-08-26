import { describe, it, expect } from 'vitest';
import { DECISION_REASONS, reasonsFor, featuresForReasons } from './decisionReasons';

describe('catalogul de motive', () => {
  it('fiecare motiv acuza cel putin o trasatura reala', () => {
    // Un buton care nu se leaga de nimic masurabil ar fi o minciuna politicoasa:
    // omul crede ca a invatat motorul ceva, si n-a invatat nimic.
    for (const r of DECISION_REASONS) {
      expect(r.features.length, r.id).toBeGreaterThan(0);
    }
  });

  it('toate trasaturile numite exista in vectorul motorului', async () => {
    // Un `features: ['bokeh']` scris gresit ar trece tacut prin tot lantul si
    // n-ar antrena nimic. Verificam fata de PRIOR_WEIGHTS, sursa adevarului.
    const engine = await import('./learning/ContextEngine');
    const known = new Set(Object.keys(engine.PRIOR_WEIGHTS));
    for (const r of DECISION_REASONS) {
      for (const f of r.features) expect(known.has(f), `${r.id} -> ${f}`).toBe(true);
    }
  });

  it('exista motive si pentru respins, si pentru pastrat', () => {
    expect(reasonsFor('rejected').length).toBeGreaterThan(4);
    expect(reasonsFor('selected').length).toBeGreaterThan(2);
  });

  it('featuresForReasons aduna fara duplicate', () => {
    // "neclara" si "subiectul nu e in focus" impart doua trasaturi.
    const f = featuresForReasons(['blurry', 'subjectSoft']);
    expect(new Set(f).size).toBe(f.length);
    expect(f).toContain('sharpness');
    expect(f).toContain('subjectInFocus');
  });

  it('un id necunoscut e ignorat, nu arunca', () => {
    // O inregistrare salvata de o versiune mai veche n-are voie sa rupa o decizie.
    expect(featuresForReasons(['motiv-care-nu-mai-exista'])).toEqual([]);
    expect(featuresForReasons(['blurry', 'inventat'])).toContain('sharpness');
  });
});
