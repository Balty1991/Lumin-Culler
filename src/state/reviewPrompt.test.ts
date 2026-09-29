import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * state/reviewPrompt.test.ts
 * Regula care apara tot fisierul: se intreaba O SINGURA DATA, dupa un export
 * care chiar inseamna ceva. Orice cale care ar intreba de doua ori strica
 * notele pe care cererea trebuia sa le aduca.
 */
let disponibil = true;
const cerut = vi.fn(async () => true);
vi.mock('../core/inAppReview', () => ({
  isInAppReviewAvailable: () => disponibil,
  requestInAppReview: () => cerut()
}));

async function modul() {
  return await import('./reviewPrompt');
}

beforeEach(() => {
  localStorage.clear();
  disponibil = true;
  cerut.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('shouldAskForReview', () => {
  it('intreaba dupa un export destul de mare, daca n-a mai intrebat', async () => {
    const { shouldAskForReview, MIN_EXPORTED_FOR_REVIEW } = await modul();
    expect(shouldAskForReview({ available: true, asked: false, exported: MIN_EXPORTED_FOR_REVIEW })).toBe(true);
  });

  it('nu dupa un export mic — ala e un test, nu o sesiune terminata', async () => {
    const { shouldAskForReview, MIN_EXPORTED_FOR_REVIEW } = await modul();
    expect(shouldAskForReview({ available: true, asked: false, exported: MIN_EXPORTED_FOR_REVIEW - 1 })).toBe(false);
  });

  it('nu a doua oara', async () => {
    const { shouldAskForReview } = await modul();
    expect(shouldAskForReview({ available: true, asked: true, exported: 500 })).toBe(false);
  });

  it('nu pe web, unde nu exista fereastra Play', async () => {
    const { shouldAskForReview } = await modul();
    expect(shouldAskForReview({ available: false, asked: false, exported: 500 })).toBe(false);
  });
});

describe('maybeAskForReview', () => {
  it('cere fereastra dupa pauza, ca omul sa vada intai confirmarea exportului', async () => {
    const { maybeAskForReview, REVIEW_DELAY_MS } = await modul();
    maybeAskForReview(40);
    expect(cerut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS);
    expect(cerut).toHaveBeenCalledTimes(1);
  });

  it('o singura data, oricate exporturi urmeaza', async () => {
    const { maybeAskForReview, REVIEW_DELAY_MS } = await modul();
    maybeAskForReview(40);
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS);
    maybeAskForReview(80);
    maybeAskForReview(120);
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS);
    expect(cerut).toHaveBeenCalledTimes(1);
  });

  it('marcheaza INAINTE de cerere — o cadere intre ele nu duce la a doua intrebare', async () => {
    const { maybeAskForReview, readReviewAsked } = await modul();
    maybeAskForReview(40);
    // Inainte ca fereastra sa fi fost ceruta, e deja marcat.
    expect(readReviewAsked()).toBe(true);
  });

  it('un export mic nu consuma singura intrebare', async () => {
    const { maybeAskForReview, readReviewAsked, REVIEW_DELAY_MS } = await modul();
    maybeAskForReview(3);
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS);
    expect(cerut).not.toHaveBeenCalled();
    expect(readReviewAsked()).toBe(false);
  });

  it('daca omul a plecat intre timp in alta aplicatie, asteapta sa se intoarca', async () => {
    const { maybeAskForReview, REVIEW_DELAY_MS } = await modul();
    const stare = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    maybeAskForReview(40);
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS * 3);
    expect(cerut).not.toHaveBeenCalled();

    stare.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(REVIEW_DELAY_MS);
    expect(cerut).toHaveBeenCalledTimes(1);
    stare.mockRestore();
  });

  it('pe web nu atinge stocarea deloc', async () => {
    disponibil = false;
    const { maybeAskForReview, readReviewAsked } = await modul();
    maybeAskForReview(500);
    expect(readReviewAsked()).toBe(false);
  });
});
