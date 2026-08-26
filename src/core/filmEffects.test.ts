import { describe, it, expect } from 'vitest';
import { applyCinematicGrade, applyGrain } from './imageAdjust';

/**
 * Cele doua efecte noi din grupul EFECTE. Sunt matematica pe pixeli, deci se
 * verifica direct, fara canvas — spre deosebire de bokeh, care a trait patru
 * build-uri stricat tocmai fiindca partea lui de compunere nu era testabila
 * decat intr-un browser.
 */

/** Un sir RGBA dintr-o lista de culori. */
function pixeli(...culori: [number, number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(culori.length * 4);
  culori.forEach(([r, g, b], i) => { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; });
  return d;
}
const rgb = (d: Uint8ClampedArray, i = 0) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];

describe('ton cinematic', () => {
  it('raceste umbrele — mai putin rosu, mai mult albastru', () => {
    const d = pixeli([30, 30, 30]);
    applyCinematicGrade(d, 100);
    const [r, , b] = rgb(d);
    expect(r).toBeLessThan(30);
    expect(b).toBeGreaterThan(30);
  });

  it('incalzeste luminile — mai mult rosu, mai putin albastru', () => {
    const d = pixeli([225, 225, 225]);
    applyCinematicGrade(d, 100);
    const [r, , b] = rgb(d);
    expect(r).toBeGreaterThan(225);
    expect(b).toBeLessThan(225);
  });

  it('lasa tonurile MEDII aproape neatinse — acolo sta pielea', () => {
    // O gradare care muta si mijlocul face fetele verzui: cel mai vizibil semn
    // de "filtru pus", si motivul pentru care cele doua capete se despart cu o
    // curba neteda, nu cu un prag.
    const d = pixeli([128, 128, 128]);
    applyCinematicGrade(d, 100);
    for (const canal of rgb(d)) expect(Math.abs(canal - 128)).toBeLessThanOrEqual(2);
  });

  it('la 0 nu schimba niciun pixel', () => {
    const d = pixeli([30, 90, 200], [240, 10, 60]);
    const inainte = [...d];
    applyCinematicGrade(d, 0);
    expect([...d]).toEqual(inainte);
  });

  it('creste cu intensitatea, si nu iese din 0..255', () => {
    const slab = pixeli([40, 40, 40]); applyCinematicGrade(slab, 30);
    const tare = pixeli([40, 40, 40]); applyCinematicGrade(tare, 100);
    expect(Math.abs(rgb(tare)[2] - 40)).toBeGreaterThan(Math.abs(rgb(slab)[2] - 40));
    const extrem = pixeli([0, 0, 0], [255, 255, 255]);
    applyCinematicGrade(extrem, 100);
    for (const v of extrem) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('granulație', () => {
  it('e DETERMINISTA — acelasi pixel da mereu acelasi bob', () => {
    // Cu Math.random() bobul ar fi fiert sub deget la fiecare redesenare, si ar
    // fi iesit alt bob la export decat cel vazut in editor.
    const a = pixeli([120, 120, 120], [120, 120, 120], [120, 120, 120]);
    const b = pixeli([120, 120, 120], [120, 120, 120], [120, 120, 120]);
    applyGrain(a, 3, 80);
    applyGrain(b, 3, 80);
    expect([...a]).toEqual([...b]);
  });

  it('chiar schimba pixelii, si nu la fel pe toti', () => {
    const d = pixeli([120, 120, 120], [120, 120, 120], [120, 120, 120], [120, 120, 120]);
    applyGrain(d, 4, 100);
    const valori = [0, 1, 2, 3].map(i => rgb(d, i)[0]);
    expect(valori.some(v => v !== 120)).toBe(true);
    expect(new Set(valori).size).toBeGreaterThan(1);
  });

  it('se stinge in lumini — bobul peste alb se vede ca zgomot digital', () => {
    const abatere = (nivel: number) => {
      const d = pixeli(...Array.from({ length: 40 }, () => [nivel, nivel, nivel] as [number, number, number]));
      applyGrain(d, 40, 100);
      return [...Array(40).keys()].reduce((s, i) => s + Math.abs(rgb(d, i)[0] - nivel), 0) / 40;
    };
    expect(abatere(250)).toBeLessThan(abatere(128));
  });

  it('la 0 nu schimba niciun pixel', () => {
    const d = pixeli([70, 130, 180], [200, 40, 90]);
    const inainte = [...d];
    applyGrain(d, 2, 0);
    expect([...d]).toEqual(inainte);
  });

  it('muta toate cele trei canale la fel — bob neutru, nu colorat', () => {
    const d = pixeli([100, 140, 180]);
    applyGrain(d, 1, 100);
    const [r, g, b] = rgb(d);
    expect(r - 100).toBeCloseTo(g - 140, 0);
    expect(g - 140).toBeCloseTo(b - 180, 0);
  });
});
