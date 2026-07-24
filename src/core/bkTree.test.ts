import { describe, expect, it } from 'vitest';
import { bkInsert, bkQuery, type BKNode } from './bkTree';

function hammingDistance(a: string, b: string): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Sir binar aleator de lungime `bits`, ca sa semene cu un dHash real (9x8=64 biti). */
function randomBits(bits: number, rng: () => number): string {
  let s = '';
  for (let i = 0; i < bits; i++) s += rng() < 0.5 ? '0' : '1';
  return s;
}

/** PRNG simplu, determinist (seed fix) — reproductibil intre rulari, fara dependinta de Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Referinta independenta: cautare liniara O(n), aceeasi semantica ca bkQuery — folosita ca sa verifice arborele, nu propria lui logica. */
function bruteForceQuery(keys: string[], target: string, radius: number): string[] {
  return keys.filter(k => hammingDistance(k, target) <= radius);
}

describe('bkTree', () => {
  it('gaseste exact acelasi rezultat ca o cautare liniara, pe date aleatoare (64 biti, ca un dHash real)', () => {
    const rng = mulberry32(42);
    const keys = Array.from({ length: 300 }, () => randomBits(64, rng));

    let root: BKNode<string> | null = null;
    for (const k of keys) root = bkInsert(root, k, k, hammingDistance);

    for (let i = 0; i < 20; i++) {
      const target = randomBits(64, rng);
      const radius = 8; // acelasi prag ca SIMILARITY_THRESHOLD din hashCompare.worker.ts
      const expected = bruteForceQuery(keys, target, radius).sort();
      const actual = bkQuery(root, target, radius, hammingDistance).sort();
      expect(actual).toEqual(expected);
    }
  });

  it('gaseste chei identice intre ele (distanta 0), inclusiv duplicate exacte inserate de mai multe ori', () => {
    let root: BKNode<number> | null = null;
    const hash = '1'.repeat(64);
    root = bkInsert(root, hash, 1, hammingDistance);
    root = bkInsert(root, hash, 2, hammingDistance);
    root = bkInsert(root, hash, 3, hammingDistance);
    const result = bkQuery(root, hash, 0, hammingDistance).sort();
    expect(result).toEqual([1, 2, 3]);
  });

  it('nu gaseste nimic daca toate cheile sunt in afara razei', () => {
    let root: BKNode<string> | null = null;
    root = bkInsert(root, '0'.repeat(64), 'a', hammingDistance);
    const farKey = '1'.repeat(64); // distanta 64 fata de radacina
    root = bkInsert(root, farKey, 'b', hammingDistance);
    const result = bkQuery(root, '0'.repeat(64), 8, hammingDistance);
    expect(result).toEqual(['a']);
  });

  it('arbore gol (radacina null) returneaza rezultat gol, nu arunca', () => {
    expect(bkQuery<string>(null, 'oricare', 8, hammingDistance)).toEqual([]);
  });
});
