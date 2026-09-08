import { describe, it, expect } from 'vitest';
import { stabilizeEta, createEtaTracker } from './etaEstimate';

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

/**
 * Ritmul RECENT, nu media intregului lot.
 *
 * Bug raportat cu doua capturi: 33/77 "cam 50s", apoi 44/77 "cam 45s". Refacand
 * calculul, ritmul din fereastra dintre ele era ~2 s/poza, dar estimarea pornea
 * de la ~1,4 — media de la inceputul lotului, trasa in jos de pozele rapide de
 * la rece. Numarul ramanea optimist pana spre final, cand cadea brusc.
 */
describe('estimarea urmareste ritmul recent', () => {
  it('cand analiza INCETINESTE, estimarea creste — media de la inceput o ascundea', () => {
    const t = createEtaTracker();
    // 30 de poze la 1 s/poza (telefon rece), apoi 20 la 3 s/poza (incalzit).
    let sec = 0;
    for (let done = 1; done <= 30; done++) { sec += 1; t.sample(sec, done, 100); }
    const dupaRapide = t.sample(sec, 30, 100)!;
    for (let done = 31; done <= 50; done++) { sec += 3; t.sample(sec, done, 100); }
    const dupaLente = t.sample(sec, 50, 100)!;

    // Media de la inceput ar fi dat (90/50)*50 = 90s. Ritmul recent da ~3*50 = 150s.
    expect(dupaLente).toBeGreaterThan(120);
    // ...si mult peste ce ar fi spus in faza rapida, desi au ramas MAI PUTINE poze.
    expect(dupaLente).toBeGreaterThan(dupaRapide);
  });

  it('cand analiza ACCELEREAZA, estimarea scade la fel de repede', () => {
    const t = createEtaTracker();
    let sec = 0;
    for (let done = 1; done <= 30; done++) { sec += 3; t.sample(sec, done, 100); }
    for (let done = 31; done <= 60; done++) { sec += 1; t.sample(sec, done, 100); }
    // Ritm recent 1 s/poza, 40 ramase -> ~40s. Media de la inceput ar fi zis ~80s.
    expect(t.sample(sec, 60, 100)!).toBeLessThan(60);
  });

  // Cazul raportat cu trei capturi, reprodus din cifrele afisate atunci: cinci
  // poze in primele patru secunde (un ciorchine de terminari), apoi doua in
  // urmatoarele paisprezece. Vechea fereastra de cinci poze incapea intreaga in
  // ciorchine si spunea 1m30s; doua poze mai tarziu spunea 4m30s.
  it('nu se lasa pacalita de ciorchinele de terminari de la inceput', () => {
    const t = createEtaTracker();
    for (let done = 1; done <= 5; done++) t.sample(done * 0.85, done, 111);
    expect(t.sample(4.25, 5, 111)).toBeUndefined();
    expect(t.sample(11, 6, 111)).toBeUndefined();
    expect(t.sample(18.2, 7, 111)).toBeUndefined();
  });

  it('vorbeste abia cand are si destule poze, si destule secunde', () => {
    const t = createEtaTracker();
    // Fereastra se masoara de la PRIMA masuratoare retinuta, deci ca sa cuprinda
    // douasprezece poze e nevoie de treisprezece esantioane.
    //
    // Aici sunt destule ca numar, dar toate intr-o secunda si jumatate: prea
    // putine ca timp. Exact forma unui ciorchine mare.
    for (let done = 1; done <= 13; done++) t.sample(done * 0.12, done, 100);
    expect(t.sample(1.56, 13, 100)).toBeUndefined();

    // Aceleasi douasprezece poze, dar intr-un interval care cuprinde si pauzele:
    // 24 de secunde, adica 2 s/poza, 87 ramase -> ~174s.
    const u = createEtaTracker();
    for (let done = 1; done <= 13; done++) u.sample(done * 2, done, 100);
    expect(u.sample(26, 13, 100)).toBeCloseTo(174, 0);
  });

  it('nu spune nimic cat timp n-are nimic de spus', () => {
    const t = createEtaTracker();
    expect(t.sample(0.5, 0, 100)).toBeUndefined();
  });

  it('lotul terminat nu mai are timp ramas', () => {
    const t = createEtaTracker();
    expect(t.sample(50, 100, 100)).toBeUndefined();
  });
});
