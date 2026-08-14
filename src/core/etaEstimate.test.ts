import { describe, it, expect } from 'vitest';
import { stabilizeEta } from './etaEstimate';

describe('stabilizeEta', () => {
  it('prima estimare se arata ca atare, doar rotunjita', () => {
    expect(stabilizeEta(undefined, 88)).toBe(90);
    expect(stabilizeEta(undefined, 42)).toBe(40);
    expect(stabilizeEta(undefined, 1)).toBe(5);
  });

  it('scaderile trec mereu — asta e numaratoarea inversa normala', () => {
    expect(stabilizeEta(90, 74)).toBe(75);
    expect(stabilizeEta(75, 30)).toBe(30);
  });

  /**
   * Bug real raportat de utilizator: numarul urca intre doua poze consecutive.
   * O poza mai grea (RAW, multe fete) misca media, dar nu inseamna ca mai e de
   * asteptat mai mult decat scria acum o secunda.
   */
  it('o crestere mica e tinuta pe loc, nu aratata', () => {
    expect(stabilizeEta(90, 95)).toBe(90);
    expect(stabilizeEta(90, 104)).toBe(90);
  });

  it('o crestere reala (peste 25%) se arata', () => {
    expect(stabilizeEta(90, 150)).toBe(150);
    expect(stabilizeEta(60, 200)).toBe(195);
  });

  it('rotunjeste mai grosier cu cat mai mult e de asteptat', () => {
    expect(stabilizeEta(undefined, 27)).toBe(25);       // sub 1 min: din 5 in 5
    expect(stabilizeEta(undefined, 188)).toBe(195);     // sub 10 min: din 15 in 15
    expect(stabilizeEta(undefined, 1250)).toBe(1260);   // peste: din minut in minut
  });

  /** Un sir realist de estimari brute nu are voie sa urce niciodata pe ecran fara motiv. */
  it('pe un lot intreg, valoarea afisata nu urca din zgomot', () => {
    const raw = [300, 318, 295, 306, 280, 291, 264, 270, 240, 210, 160, 120, 80, 40, 12];
    let shown: number | undefined;
    const seen: number[] = [];
    for (const r of raw) {
      shown = stabilizeEta(shown, r);
      seen.push(shown);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `pasul ${i}: ${seen[i - 1]} -> ${seen[i]}`).toBeLessThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(10);
  });
});
