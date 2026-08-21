import { describe, expect, it } from 'vitest';
import { computeHistogram, histogramPath, BUCKETS } from './histogram';

/** Imagine uniforma de o singura culoare. */
function plat(r: number, g: number, b: number, n = 64): ImageData {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { d[i*4] = r; d[i*4+1] = g; d[i*4+2] = b; d[i*4+3] = 255; }
  return { data: d, width: n, height: 1, colorSpace: 'srgb' } as ImageData;
}

describe('histograma', () => {
  it('o imagine uniforma cade intr-o singura treapta', () => {
    const h = computeHistogram(plat(128, 128, 128), 1);
    expect(h.luma.filter(v => v > 0)).toHaveLength(1);
  });

  it('negrul si albul cad la capete opuse', () => {
    expect(computeHistogram(plat(0, 0, 0), 1).luma[0]).toBeGreaterThan(0);
    expect(computeHistogram(plat(255, 255, 255), 1).luma[BUCKETS - 1]).toBeGreaterThan(0);
  });

  it('raporteaza cat e lipit de capete', () => {
    expect(computeHistogram(plat(0, 0, 0), 1).clippedShadows).toBe(1);
    expect(computeHistogram(plat(255, 255, 255), 1).clippedHighlights).toBe(1);
    const mijloc = computeHistogram(plat(128, 128, 128), 1);
    expect(mijloc.clippedShadows).toBe(0);
    expect(mijloc.clippedHighlights).toBe(0);
  });

  it('un canal ars conteaza chiar daca luminanta pare cuminte', () => {
    // rosu ars pe un apus: luminanta ~85, deci nu pare nimic in neregula
    const h = computeHistogram(plat(255, 40, 20), 1);
    expect(h.clippedHighlights).toBe(1);
  });

  it('canalele se numara separat', () => {
    const h = computeHistogram(plat(255, 0, 0), 1);
    expect(h.r[BUCKETS - 1]).toBeGreaterThan(0);
    expect(h.g[0]).toBeGreaterThan(0);
    expect(h.b[0]).toBeGreaterThan(0);
  });

  it('pasul de esantionare schimba costul, nu silueta', () => {
    const n = 256;
    const d = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { d[i*4] = d[i*4+1] = d[i*4+2] = i; d[i*4+3] = 255; }
    const img = { data: d, width: n, height: 1, colorSpace: 'srgb' } as ImageData;
    const plin = computeHistogram(img, 1);
    const rar = computeHistogram(img, 4);
    // aceleasi trepte ocupate, doar cu mai putine esantioane in ele
    expect(Array.from(rar.luma, v => v > 0)).toEqual(Array.from(plin.luma, v => v > 0));
  });

  it('nu se sufoca pe o imagine goala', () => {
    const gol = { data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' } as ImageData;
    const h = computeHistogram(gol);
    expect(h.peak).toBe(0);
    expect(h.clippedShadows).toBe(0);
  });
});

describe('traseul de desen', () => {
  it('se inchide pe linia de baza, ca sa poata fi umplut', () => {
    const h = computeHistogram(plat(128, 128, 128), 1);
    const p = histogramPath(h.luma, h.peak, 100, 40);
    expect(p.startsWith('M 0 40')).toBe(true);
    expect(p.endsWith('L 100 40 Z')).toBe(true);
  });

  it('fara varf nu deseneaza nimic', () => {
    expect(histogramPath(new Uint32Array(BUCKETS), 0, 100, 40)).toBe('');
  });

  it('varful atinge partea de sus a cutiei', () => {
    const h = computeHistogram(plat(128, 128, 128), 1);
    const p = histogramPath(h.luma, h.peak, 100, 40);
    expect(p).toContain(' 0.0');
  });
});
