import { describe, it, expect, beforeEach } from 'vitest';
import { placeCacheKey, resolvePlaceNames } from './reverseGeocode';

describe('placeCacheKey', () => {
  /** ~1 km: doua grupuri din acelasi oras cad pe aceeasi intrare, doua localitati vecine nu. */
  it('rounds to about a kilometre', () => {
    expect(placeCacheKey(44.11431, 24.98677)).toBe('44.11,24.99');
    expect(placeCacheKey(44.11439, 24.98671)).toBe(placeCacheKey(44.11431, 24.98677));
    expect(placeCacheKey(44.43, 26.10)).not.toBe(placeCacheKey(44.11, 24.99));
  });

  it('keeps the southern/western hemispheres apart', () => {
    expect(placeCacheKey(-33.87, 151.21)).toBe('-33.87,151.21');
  });
});

describe('resolvePlaceNames', () => {
  beforeEach(() => localStorage.clear());

  it('returns nothing for an empty request', async () => {
    expect((await resolvePlaceNames([])).size).toBe(0);
  });

  /**
   * Pe web (fara plugin nativ) nu se intreaba nimic — dar numele deja stiute
   * trebuie sa iasa din memoria locala, nu sa se piarda. Acelasi drum se
   * parcurge si pe telefon cand nu exista retea.
   */
  it('serves known places from the local cache, without asking anything', async () => {
    localStorage.setItem('lumin-place-names', JSON.stringify({ '44.11,24.99': 'Roșiori de Vede, România' }));
    const names = await resolvePlaceNames([{ key: 'g1', latitude: 44.11431, longitude: 24.98677 }]);
    expect(names.get('g1')).toBe('Roșiori de Vede, România');
  });

  it('leaves unknown places out instead of inventing a label', async () => {
    const names = await resolvePlaceNames([{ key: 'g1', latitude: 48.86, longitude: 2.35 }]);
    expect(names.has('g1')).toBe(false);
  });

  it('survives a corrupted cache', async () => {
    localStorage.setItem('lumin-place-names', 'nu e json');
    const names = await resolvePlaceNames([{ key: 'g1', latitude: 44.11, longitude: 24.99 }]);
    expect(names.size).toBe(0);
  });
});
