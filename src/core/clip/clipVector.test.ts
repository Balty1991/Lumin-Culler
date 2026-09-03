import { describe, expect, it } from 'vitest';
import { normalize, cosine, centroid, nearest, type ClipVector } from './clipVector';

/**
 * core/clip/clipVector.test.ts
 *
 * Testele de aici pazesc un singur lucru, si e cel mai important din toata
 * integrarea CLIP: doi vectori din modele diferite nu se compara NICIODATA.
 * Nu pentru ca ar da eroare — cosinusul lor e un numar valid si complet fara
 * sens. Nimic nu crapa; doar toate raspunsurile devin gresite, tacut.
 */
function vec(modelId: string, ...values: number[]): ClipVector {
  return { modelId, values: normalize(new Float32Array(values)) };
}

describe('normalize', () => {
  it('duce vectorul la lungimea 1', () => {
    const n = normalize(new Float32Array([3, 4]));
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
    expect(n[0]).toBeCloseTo(0.6, 6);
  });

  it('un vector nul ramane nul, NU devine NaN', () => {
    // Un zero se citeste la comparatie ca "similaritate 0". Un NaN se strecoara
    // prin sortari si contamineaza tot ce atinge, fara sa se anunte.
    const n = normalize(new Float32Array([0, 0, 0]));
    expect([...n]).toEqual([0, 0, 0]);
    expect([...n].some(Number.isNaN)).toBe(false);
  });

  it('valorile nefinite nu produc NaN in iesire', () => {
    const n = normalize(new Float32Array([Infinity, 1]));
    expect([...n].some(Number.isNaN)).toBe(false);
  });
});

describe('cosine — bariera intre spatii', () => {
  it('REFUZA doi vectori din modele diferite', () => {
    // Piatra de temelie. Fara asta, "poze similare" ar intoarce poze la
    // intamplare dupa orice schimbare de model, fara niciun semn.
    const a = vec('mobileclip_s0@abc', 1, 0, 0);
    const b = vec('mobilenet_v3@xyz', 1, 0, 0);
    expect(cosine(a, b)).toBeNull();
  });

  it('refuza si doi vectori cu ACELASI id dar lungimi diferite', () => {
    // Un fisier de model stricat poate pastra id-ul si schimba dimensiunea.
    // Fara verificarea asta, bucla ar citi in gol si ar intoarce un numar.
    const a: ClipVector = { modelId: 'x', values: new Float32Array([1, 0, 0]) };
    const b: ClipVector = { modelId: 'x', values: new Float32Array([1, 0]) };
    expect(cosine(a, b)).toBeNull();
  });

  it('refuza vectorii goi', () => {
    const gol: ClipVector = { modelId: 'x', values: new Float32Array(0) };
    expect(cosine(gol, gol)).toBeNull();
  });

  it('doua poze identice dau 1, doua opuse dau -1', () => {
    expect(cosine(vec('m', 1, 2, 3), vec('m', 1, 2, 3))!).toBeCloseTo(1, 6);
    expect(cosine(vec('m', 1, 0), vec('m', -1, 0))!).toBeCloseTo(-1, 6);
    expect(cosine(vec('m', 1, 0), vec('m', 0, 1))!).toBeCloseTo(0, 6);
  });

  it('nu iese niciodata din intervalul [-1, 1]', () => {
    // Acumularea in virgula mobila da 1.0000001 pe vectori identici, iar un
    // scor "peste 1" arata a bug oriunde l-ai afisa.
    const lung = vec('m', ...Array.from({ length: 512 }, () => 1));
    expect(cosine(lung, lung)!).toBeLessThanOrEqual(1);
    expect(cosine(lung, lung)!).toBeGreaterThanOrEqual(-1);
  });
});

describe('centroid', () => {
  it('da directia medie, normalizata', () => {
    const c = centroid([vec('m', 1, 0), vec('m', 0, 1)])!;
    expect(c.values[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(c.values[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('REFUZA un set amestecat, in loc sa faca media a doua spatii', () => {
    // Media dintre doua spatii diferite nu e inexacta — e lipsita de sens.
    expect(centroid([vec('a', 1, 0), vec('b', 0, 1)])).toBeNull();
  });

  it('un set gol nu are centroida', () => {
    expect(centroid([])).toBeNull();
  });
});

describe('nearest', () => {
  it('ordoneaza descrescator si taie la limita', () => {
    const query = vec('m', 1, 0);
    const rezultate = nearest(query, [
      { id: 'departe', vector: vec('m', -1, 0) },
      { id: 'aproape', vector: vec('m', 0.9, 0.1) },
      { id: 'mediu', vector: vec('m', 0.5, 0.5) }
    ], 2);
    expect(rezultate.map(r => r.item.id)).toEqual(['aproape', 'mediu']);
  });

  it('SARE pozele din alt model, nu le trateaza ca nepotriviri', () => {
    // Diferenta conteaza: o poza analizata cu modelul vechi nu e "diferita",
    // e "necunoscuta". Tratata ca nepotrivire, ar aparea pe ultimul loc ca si
    // cum stiam ceva despre ea.
    const query = vec('nou', 1, 0);
    const rezultate = nearest(query, [
      { id: 'vechi', vector: vec('vechi', 1, 0) },
      { id: 'nou', vector: vec('nou', 0.8, 0.2) }
    ], 5);
    expect(rezultate.map(r => r.item.id)).toEqual(['nou']);
  });

  it('respecta pragul minim', () => {
    const query = vec('m', 1, 0);
    expect(nearest(query, [{ id: 'slab', vector: vec('m', 0.1, 0.99) }], 5, 0.5)).toEqual([]);
  });
});
