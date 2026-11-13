import { describe, it, expect } from 'vitest';
import { blendWithPrior, buildTasteModel, crossValidate, plattFit, predictTaste, preferModel, tasteLogit, trainLogistic, usableTaste, type TasteModel, type TastePair, type TasteSample } from './personalTaste';

// Două „gusturi” separabile: păstrate în jurul unei direcții, scoase în jurul alteia.
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
function sample(dir: number[], r: () => number): number[] { return dir.map(v => v + (r() - 0.5) * 0.6); }

describe('personalTaste', () => {
  const r = rng(7);
  const d = 32;
  const keepDir = Array.from({ length: d }, (_, i) => (i < 16 ? 1 : 0));
  const dropDir = Array.from({ length: d }, (_, i) => (i >= 16 ? 1 : 0));
  const samples: TasteSample[] = [
    ...Array.from({ length: 20 }, () => ({ x: sample(keepDir, r), y: 1 as const })),
    ...Array.from({ length: 20 }, () => ({ x: sample(dropDir, r), y: 0 as const }))
  ];

  it('învață să despartă ce păstrezi de ce scoți', () => {
    const m = trainLogistic(samples);
    expect(predictTaste(m, keepDir)).toBeGreaterThan(0.8);
    expect(predictTaste(m, dropDir)).toBeLessThan(0.2);
  });

  it('se folosește doar dacă ghicește alegeri nevăzute', () => {
    const m = buildTasteModel(samples);
    expect(usableTaste(m)).toBe(true);
    expect(m!.accuracy).toBeGreaterThanOrEqual(0.7);
  });

  it('cu prea puține alegeri, nu există model', () => {
    expect(buildTasteModel(samples.slice(0, 10))).toBeNull();
  });

  it('învață și doar din perechi „asta, nu aia”', () => {
    const pairs: TastePair[] = Array.from({ length: 30 }, () => ({ w: sample(keepDir, r), l: sample(dropDir, r) }));
    const m = trainLogistic([], 300, 0.8, 0.002, pairs);
    expect(tasteLogit(m, keepDir)).toBeGreaterThan(tasteLogit(m, dropDir));
  });

  it('validarea pe zile nu se lasă păcălită de poze aproape identice din aceeași zi', () => {
    // Fiecare zi: 4 copii aproape identice, cu aceeași decizie; între zile, decizia e la întâmplare.
    const rr = rng(11);
    const days: TasteSample[] = [];
    for (let k = 0; k < 16; k++) {
      const base = Array.from({ length: d }, () => rr() - 0.5);
      const y = (rr() < 0.5 ? 1 : 0) as 0 | 1;
      for (let c = 0; c < 4; c++) days.push({ x: base.map(v => v + (rr() - 0.5) * 0.01), y, g: `d${k}` });
    }
    const leaky = crossValidate(days.map(s => ({ x: s.x, y: s.y })));
    const fair = crossValidate(days);
    expect(leaky).toBeGreaterThan(0.85);
    expect(fair).toBeLessThan(leaky - 0.2);
  });

  it('calibrarea Platt păstrează ordinea și nu inversează', () => {
    const oof = Array.from({ length: 40 }, (_, i) => ({ z: (i - 20) / 2, y: (i >= 20 ? 1 : 0) as 0 | 1 }));
    const { a } = plattFit(oof);
    expect(a).toBeGreaterThan(0);
    expect(plattFit([{ z: 1, y: 1 }])).toEqual({ a: 1, b: 0 });
  });

  it('cu puține exemple, părerea e trasă spre scorul general', () => {
    const base = { w: keepDir.map(v => v * 20), b: -10, ca: 1, cb: 0 };
    const few = blendWithPrior({ ...base, n: 3 }, keepDir, 0.5);
    const many = blendWithPrior({ ...base, n: 3000 }, keepDir, 0.5);
    expect(many).toBeGreaterThan(few);
    expect(few).toBeLessThan(0.6);
  });

  it('modelul nou îl înlocuiește pe cel vechi doar dacă nu e mai slab', () => {
    const mk = (accuracy: number): TasteModel => ({ w: [0, 0], b: 0, n: 30, accuracy, at: 0, ca: 1, cb: 0 });
    expect(preferModel(mk(0.8), mk(0.9)).accuracy).toBe(0.9);
    expect(preferModel(mk(0.89), mk(0.9)).accuracy).toBe(0.89);
    expect(preferModel(mk(0.75), null).accuracy).toBe(0.75);
    expect(preferModel(mk(0.75), { ...mk(0.95), ca: undefined }).accuracy).toBe(0.75);
  });
});
