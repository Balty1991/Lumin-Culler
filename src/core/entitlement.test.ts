import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isPremium, recordPhotosUsed, photosUsedInRollingMonth, remainingFreePhotos,
  canEnrollAnotherPersonFree, isPremiumFeatureLocked, subscribeEntitlement,
  FREE_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS
} from './entitlement';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe('entitlement (freemium local tracking)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isPremium() is false by default — no billing plugin has written the flag yet', () => {
    expect(isPremium()).toBe(false);
  });

  it('remainingFreePhotos() starts at the full monthly allowance', () => {
    expect(remainingFreePhotos()).toBe(FREE_PHOTOS_PER_MONTH);
  });

  it('recordPhotosUsed() reduces the remaining free allowance by the recorded count', () => {
    const now = Date.now();
    recordPhotosUsed(40, now);
    expect(photosUsedInRollingMonth(now)).toBe(40);
    expect(remainingFreePhotos(now)).toBe(FREE_PHOTOS_PER_MONTH - 40);
  });

  it('never goes negative once the cap is exceeded', () => {
    const now = Date.now();
    recordPhotosUsed(FREE_PHOTOS_PER_MONTH + 50, now);
    expect(remainingFreePhotos(now)).toBe(0);
  });

  it('exports older than the 30-day rolling window no longer count against the cap', () => {
    const now = Date.now();
    recordPhotosUsed(100, now - 31 * DAY_MS); // outside the window
    recordPhotosUsed(20, now); // inside the window
    expect(photosUsedInRollingMonth(now)).toBe(20);
    expect(remainingFreePhotos(now)).toBe(FREE_PHOTOS_PER_MONTH - 20);
  });

  it('ignores a non-positive count (nothing to record)', () => {
    recordPhotosUsed(0);
    recordPhotosUsed(-5);
    expect(photosUsedInRollingMonth()).toBe(0);
  });

  it('remainingFreePhotos() is Infinity once premium is active, regardless of usage', () => {
    localStorage.setItem('lumin-premium', '1');
    recordPhotosUsed(FREE_PHOTOS_PER_MONTH + 500);
    expect(remainingFreePhotos()).toBe(Infinity);
  });

  describe('canEnrollAnotherPersonFree', () => {
    it('allows enrolling up to FREE_ENROLLED_PERSONS for free', () => {
      expect(canEnrollAnotherPersonFree(0)).toBe(true);
      expect(FREE_ENROLLED_PERSONS).toBeGreaterThan(0);
    });

    it('blocks (informationally) enrolling beyond the free limit for non-premium users', () => {
      expect(canEnrollAnotherPersonFree(FREE_ENROLLED_PERSONS)).toBe(false);
    });

    it('never limits a premium user, regardless of how many persons are already enrolled', () => {
      localStorage.setItem('lumin-premium', '1');
      expect(canEnrollAnotherPersonFree(999)).toBe(true);
    });
  });
});

/**
 * Jurnalul de folosire: formatul comprimat pe ore, migrarea din formatul vechi
 * si rezistenta la un ceas de telefon dat peste cap. Vezi core/entitlement.ts.
 */
describe('jurnalul de folosire (format comprimat)', () => {
  beforeEach(() => localStorage.clear());

  it('nu creste nemarginit: 5000 de apeluri in aceeasi ora raman o singura intrare', () => {
    const now = Date.now();
    for (let i = 0; i < 5000; i++) recordPhotosUsed(1, now);
    expect(photosUsedInRollingMonth(now)).toBe(5000);
    const stored: unknown = JSON.parse(localStorage.getItem('lumin-export-log')!);
    expect(Array.isArray(stored) && stored.length).toBe(1);
  });

  it('o fereastra de 30 de zile are cel mult ~720 de intrari, oricate poze trec prin ea', () => {
    const now = Date.now();
    // cate un export la fiecare ora, timp de 20 de zile
    for (let h = 0; h < 20 * 24; h++) recordPhotosUsed(50, now - h * HOUR_MS);
    const stored = JSON.parse(localStorage.getItem('lumin-export-log')!) as unknown[];
    expect(stored.length).toBeLessThanOrEqual(30 * 24);
  });

  it('citeste jurnalul in formatul VECHI (un timestamp per poza) fara sa piarda contorul', () => {
    const now = Date.now();
    // exact ce scria versiunea anterioara a aplicatiei
    localStorage.setItem('lumin-export-log', JSON.stringify([now, now, now, now - 40 * DAY_MS]));
    expect(photosUsedInRollingMonth(now)).toBe(3); // a patra e in afara ferestrei
  });

  it('converteste formatul vechi la scriere, pastrand totalul', () => {
    const now = Date.now();
    localStorage.setItem('lumin-export-log', JSON.stringify([now, now, now]));
    recordPhotosUsed(2, now);
    expect(photosUsedInRollingMonth(now)).toBe(5);
  });

  /**
   * Regresie: migrarea trebuie sa COMPRIME, nu doar sa transcrie. Un utilizator
   * care actualizeaza aplicatia avand deja un jurnal in formatul vechi (un
   * timestamp per poza — mii de intrari pentru cateva ore de export) ajungea, la
   * prima scriere, cu tot atatea perechi `[ora, 1]` in localStorage. Adica exact
   * jurnalul nemarginit pe care formatul pe ore exista ca sa-l previna, si inca
   * unul mai MARE ca inainte (o pereche ocupa mai multi octeti decat un numar),
   * deci mai aproape de QuotaExceededError, nu mai departe.
   */
  it('migrarea din formatul vechi chiar comprima: 3000 de timestampuri dintr-o ora devin o intrare', () => {
    const now = Date.now();
    const legacy = Array.from({ length: 3000 }, (_, i) => now - i); // toate in aceeasi ora
    localStorage.setItem('lumin-export-log', JSON.stringify(legacy));
    const bytesBefore = localStorage.getItem('lumin-export-log')!.length;

    recordPhotosUsed(1, now); // prima scriere de dupa actualizare

    const stored = JSON.parse(localStorage.getItem('lumin-export-log')!) as unknown[];
    expect(stored.length).toBe(1);
    expect(photosUsedInRollingMonth(now)).toBe(3001);
    expect(localStorage.getItem('lumin-export-log')!.length).toBeLessThan(bytesBefore);
  });

  it('uneste si doua intrari deja in formatul nou care cad in aceeasi ora', () => {
    const now = Date.now();
    const bucket = Math.floor(now / HOUR_MS) * HOUR_MS;
    localStorage.setItem('lumin-export-log', JSON.stringify([[bucket, 4], [bucket, 6]]));
    expect(photosUsedInRollingMonth(now)).toBe(10);
    recordPhotosUsed(1, now);
    const stored = JSON.parse(localStorage.getItem('lumin-export-log')!) as unknown[];
    expect(stored.length).toBe(1);
    expect(photosUsedInRollingMonth(now)).toBe(11);
  });

  it('ignora intrarile corupte fara sa arunce', () => {
    const now = Date.now();
    localStorage.setItem('lumin-export-log', JSON.stringify(['x', null, { a: 1 }, [now, 7], [now, -3]]));
    expect(photosUsedInRollingMonth(now)).toBe(7);
  });

  it('un JSON complet stricat nu arunca — contorul reporneste de la zero', () => {
    localStorage.setItem('lumin-export-log', '{nu e json');
    expect(() => photosUsedInRollingMonth()).not.toThrow();
    expect(photosUsedInRollingMonth()).toBe(0);
  });

  // Bug real: ceasul telefonului sarit inainte (fus gresit, NTP dupa baterie
  // descarcata) scria o intrare in viitor, care ramanea in fereastra 30 de zile
  // DUPA corectarea ceasului si epuiza plafonul cuiva care nu scosese nimic.
  it('nu numara intrari scrise cu un ceas dat mult inainte', () => {
    const now = Date.now();
    recordPhotosUsed(140, now + 300 * DAY_MS); // scris cu ceasul stricat
    expect(photosUsedInRollingMonth(now)).toBe(0);
    expect(remainingFreePhotos(now)).toBe(FREE_PHOTOS_PER_MONTH);
  });

  it('nu numara fractii sau valori nefinite', () => {
    const now = Date.now();
    recordPhotosUsed(NaN, now);
    recordPhotosUsed(Infinity, now);
    recordPhotosUsed(2.7, now);
    expect(photosUsedInRollingMonth(now)).toBe(2);
  });
});

/**
 * Bug real: cine cumpara abonamentul ramanea cu lacatele pe ecran, pentru ca
 * isPremium() citeste localStorage sincron si React n-avea de unde sa afle ca
 * raspunsul s-a schimbat.
 */
describe('subscribeEntitlement', () => {
  beforeEach(() => localStorage.clear());

  it('anunta abonatii cand se inregistreaza poze scoase', () => {
    const seen = vi.fn();
    const off = subscribeEntitlement(seen);
    recordPhotosUsed(3);
    expect(seen).toHaveBeenCalled();
    off();
  });

  it('nu mai anunta dupa dezabonare', () => {
    const seen = vi.fn();
    subscribeEntitlement(seen)();
    recordPhotosUsed(3);
    expect(seen).not.toHaveBeenCalled();
  });

  it('un abonat care arunca nu-i taie pe ceilalti de la notificare', () => {
    const boom = vi.fn(() => { throw new Error('boom'); });
    const ok = vi.fn();
    const offA = subscribeEntitlement(boom);
    const offB = subscribeEntitlement(ok);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => recordPhotosUsed(1)).not.toThrow();
    expect(ok).toHaveBeenCalled();
    offA(); offB();
    vi.restoreAllMocks();
  });
});

describe('isPremiumFeatureLocked', () => {
  beforeEach(() => localStorage.clear());

  // Regula care deosebeste un model freemium de un perete: nu blocam nimic cat
  // timp utilizatorul n-are de unde cumpara.
  it('nu blocheaza nimic cat timp Play n-a confirmat ca exista ce cumpara', () => {
    expect(isPremiumFeatureLocked()).toBe(false);
  });

  it('blocheaza cand abonamentul e cumparabil si utilizatorul nu e abonat', () => {
    localStorage.setItem('lumin-billing-ready', '1');
    expect(isPremiumFeatureLocked()).toBe(true);
  });

  it('nu blocheaza un abonat', () => {
    localStorage.setItem('lumin-billing-ready', '1');
    localStorage.setItem('lumin-premium', '1');
    expect(isPremiumFeatureLocked()).toBe(false);
  });
});
