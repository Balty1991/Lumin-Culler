import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onVisibilityChange, resetBackgroundMemory, BACKGROUND_RELEASE_DELAY_MS } from './backgroundMemory';

/**
 * Cerinta Google Play (praguri de memorie, februarie 2027) spune explicit ca
 * bitmap-urile nu trebuie tinute in memorie in starile in care aplicatia nu se
 * vede. Aici se verifica regula care decide CAND se elibereaza — nu golirea in
 * sine, care e o linie, ci intarzierea, care e partea usor de stricat.
 */
describe('eliberarea memoriei la trecerea in fundal', () => {
  beforeEach(() => { vi.useFakeTimers(); resetBackgroundMemory(); });
  afterEach(() => { resetBackgroundMemory(); vi.useRealTimers(); });

  it('elibereaza dupa ce aplicatia a stat ascunsa destul', () => {
    const elibereaza = vi.fn();
    onVisibilityChange(true, elibereaza);
    expect(elibereaza).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BACKGROUND_RELEASE_DELAY_MS);
    expect(elibereaza).toHaveBeenCalledTimes(1);
  });

  it('NU elibereaza daca omul se intoarce repede', () => {
    // Cazul de zi cu zi: comuti o secunda la altceva si revii. O golire acolo
    // ar fi insemnat reincarcarea intregii grile fix cand te uiti la ea.
    const elibereaza = vi.fn();
    onVisibilityChange(true, elibereaza);
    vi.advanceTimersByTime(2000);
    onVisibilityChange(false, elibereaza);
    vi.advanceTimersByTime(BACKGROUND_RELEASE_DELAY_MS * 2);
    expect(elibereaza).not.toHaveBeenCalled();
  });

  it('nu elibereaza de doua ori daca ecranul comuta de mai multe ori', () => {
    const elibereaza = vi.fn();
    onVisibilityChange(true, elibereaza);
    onVisibilityChange(true, elibereaza);
    onVisibilityChange(true, elibereaza);
    vi.advanceTimersByTime(BACKGROUND_RELEASE_DELAY_MS * 3);
    expect(elibereaza).toHaveBeenCalledTimes(1);
  });

  it('o revenire dupa eliberare nu reporneste nimic de la sine', () => {
    const elibereaza = vi.fn();
    onVisibilityChange(true, elibereaza);
    vi.advanceTimersByTime(BACKGROUND_RELEASE_DELAY_MS);
    onVisibilityChange(false, elibereaza);
    vi.advanceTimersByTime(BACKGROUND_RELEASE_DELAY_MS * 2);
    expect(elibereaza).toHaveBeenCalledTimes(1);
  });
});
