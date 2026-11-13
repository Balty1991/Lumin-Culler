import { describe, it, expect } from 'vitest';
import { buildTasteModel, predictTaste, trainLogistic, usableTaste, type TasteSample } from './personalTaste';

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
});
