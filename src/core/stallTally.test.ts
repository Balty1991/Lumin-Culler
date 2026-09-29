import { describe, expect, it } from 'vitest';
import { createStallTracker, STALL_THRESHOLD_MS } from './stallTally';

/**
 * core/stallTally.test.ts
 * Doua lucruri apara tot modulul:
 *  - golurile normale dintre poze nu se numara (altfel orice import ar raporta
 *    "opriri");
 *  - o oprire se atribuie dupa TOT intervalul, nu dupa clipa in care se
 *    termina: omul intra inapoi in aplicatie si abia atunci analiza porneste.
 */
describe('createStallTracker', () => {
  it('un import care merge normal nu raporteaza nicio oprire', () => {
    const t = createStallTracker(0, false);
    for (let at = 1500; at <= 60_000; at += 1500) t.progress(at, false);
    expect(t.read()).toEqual({ hiddenMs: 0, hiddenCount: 0, visibleMs: 0, visibleCount: 0 });
  });

  it('o poza grea, sub prag, nu e o oprire', () => {
    const t = createStallTracker(0, false);
    t.progress(STALL_THRESHOLD_MS - 1, false);
    expect(t.read().visibleCount).toBe(0);
  });

  it('cazul raportat: iese din aplicatie, analiza sta, intra inapoi, abia atunci porneste', () => {
    // "82 din 87 · 7 min." — iar la reintrare, analiza a reluat.
    const t = createStallTracker(0, false);
    t.progress(1_000, false);
    t.visibility(true);                  // pleaca in alta aplicatie
    t.visibility(false);                 // se intoarce dupa 7 minute...
    t.progress(1_000 + 7 * 60_000, false); // ...si abia acum se termina o poza

    const r = t.read();
    expect(r.hiddenCount, 'oprirea pusa pe seama aplicatiei, desi era in fundal').toBe(1);
    expect(r.hiddenMs).toBe(7 * 60_000);
    expect(r.visibleCount).toBe(0);
  });

  it('o oprire cu aplicatia pe ecran tot timpul e a noastra', () => {
    // Genul de defect pe care cifra asta trebuie sa-l prinda — ca OCR-ul care
    // astepta 80 de secunde.
    const t = createStallTracker(0, false);
    t.progress(1_000, false);
    t.progress(81_000, false);

    const r = t.read();
    expect(r.visibleCount).toBe(1);
    expect(r.visibleMs).toBe(80_000);
    expect(r.hiddenCount).toBe(0);
  });

  it('ascunderea se uita dupa urmatoarea poza terminata', () => {
    const t = createStallTracker(0, false);
    t.visibility(true);
    t.visibility(false);
    t.progress(1_000, false);            // intervalul ascuns s-a inchis aici
    t.progress(1_000 + 30_000, false);   // oprire noua, cu aplicatia vizibila

    expect(t.read()).toMatchObject({ hiddenCount: 0, visibleCount: 1 });
  });

  it('pornit cu aplicatia deja ascunsa, primul gol e al fundalului', () => {
    const t = createStallTracker(0, true);
    t.progress(45_000, true);
    expect(t.read()).toMatchObject({ hiddenCount: 1, hiddenMs: 45_000 });
  });

  it('opririle se aduna', () => {
    const t = createStallTracker(0, true);
    t.progress(30_000, true);
    t.progress(31_000, true);
    t.progress(91_000, true);
    expect(t.read()).toMatchObject({ hiddenCount: 2, hiddenMs: 90_000 });
  });

  it('read() da o copie — cine o tine nu vede schimbarile de dupa', () => {
    const t = createStallTracker(0, false);
    const inainte = t.read();
    t.progress(50_000, false);
    expect(inainte.visibleCount).toBe(0);
  });
});
