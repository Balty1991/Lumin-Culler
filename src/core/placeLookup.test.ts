import { describe, it, expect, beforeEach } from 'vitest';
import {
  placeCacheKey, readOnlinePlaceNames, writeOnlinePlaceNames, forgetCachedAddresses, resolvePlaceLabels
} from './placeLookup';

const near = (place: string) => `lângă ${place}`;

describe('optiunea de adrese online', () => {
  beforeEach(() => localStorage.clear());

  /**
   * Implicit OPRIT, si asta nu e un detaliu: aplicatia promite ca nu trimite
   * nimic, iar promisiunea n-are voie sa depinda de cine a citit setarile.
   */
  it('is off until the user turns it on', () => {
    expect(readOnlinePlaceNames()).toBe(false);
    writeOnlinePlaceNames(true);
    expect(readOnlinePlaceNames()).toBe(true);
    writeOnlinePlaceNames(false);
    expect(readOnlinePlaceNames()).toBe(false);
  });

  it('treats a corrupted preference as off', () => {
    localStorage.setItem('lumin-place-names-online', 'poate');
    expect(readOnlinePlaceNames()).toBe(false);
  });

  /** La oprire, adresele deja obtinute nu mai au ce cauta pe ecran. */
  it('forgets stored addresses on request', () => {
    localStorage.setItem('lumin-place-names-v2', JSON.stringify({ '44.1143,24.9868': { address: 'Strada Carpați 68', locality: 'Roșiori de Vede' } }));
    forgetCachedAddresses();
    expect(localStorage.getItem('lumin-place-names-v2')).toBeNull();
  });
});

describe('placeCacheKey', () => {
  /**
   * ~11 metri, nu ~1 km (cat era): doua poze de pe strazi diferite nu mai
   * primesc aceeasi adresa doar fiindca sunt in acelasi cartier.
   */
  it('rounds to about ten metres', () => {
    expect(placeCacheKey(44.11431, 24.98677)).toBe('44.1143,24.9868');
    expect(placeCacheKey(44.114312, 24.986771)).toBe(placeCacheKey(44.11431, 24.98677));
    // doua strazi la cateva sute de metri raman intrari diferite
    expect(placeCacheKey(44.116, 25.004)).not.toBe(placeCacheKey(44.112, 24.995));
  });

  it('keeps the southern/western hemispheres apart', () => {
    expect(placeCacheKey(-33.87, 151.21)).toBe('-33.8700,151.2100');
  });
});

describe('resolvePlaceLabels', () => {
  beforeEach(() => localStorage.clear());

  it('returns nothing for an empty request', async () => {
    expect((await resolvePlaceLabels([], 'ro', near)).size).toBe(0);
  });

  /**
   * In test nu exista nici plugin nativ, nici lista de localitati (fetch-ul
   * esueaza) — deci nu se afla niciun nume, si ecranul ramane pe eticheta lui
   * de rezerva. Ce conteaza aici e ca nu arunca si nu inventeaza.
   */
  it('stays silent instead of guessing when nothing can answer', async () => {
    const labels = await resolvePlaceLabels([{ key: 'g1', latitude: 44.11, longitude: 24.99 }], 'ro', near);
    expect(labels.has('g1')).toBe(false);
  });

  it('serves addresses already known, without asking anything', async () => {
    writeOnlinePlaceNames(true);
    localStorage.setItem('lumin-place-names-v2', JSON.stringify({
      '44.1143,24.9868': { address: 'Strada Carpați 68, Roșiori de Vede, România', locality: 'Roșiori de Vede, România' }
    }));
    const labels = await resolvePlaceLabels([{ key: 'g1', latitude: 44.11431, longitude: 24.98677 }], 'ro', near);
    expect(labels.get('g1')).toBe('Strada Carpați 68, Roșiori de Vede, România');
  });

  /**
   * Observatie a utilizatorului, cu captura: cardul unui grup scria "Strada
   * Renasterii 78", desi pozele din grup erau de pe alte strazi — eticheta se
   * calcula pe centrul grupului, un punct pe care nu s-a facut nicio poza.
   * Pentru grupuri se cere localitatea, adevarata pentru toate pozele din ele.
   */
  it('gives a group the locality, not the street of its centre', async () => {
    writeOnlinePlaceNames(true);
    localStorage.setItem('lumin-place-names-v2', JSON.stringify({
      '44.1143,24.9868': { address: 'Strada Renașterii 78, Roșiori de Vede, România', locality: 'Roșiori de Vede, România' }
    }));
    const point = [{ key: 'g1', latitude: 44.11431, longitude: 24.98677 }];
    expect((await resolvePlaceLabels(point, 'ro', near, 'locality')).get('g1')).toBe('Roșiori de Vede, România');
    expect((await resolvePlaceLabels(point, 'ro', near, 'address')).get('g1')).toBe('Strada Renașterii 78, Roșiori de Vede, România');
  });

  /** Cu optiunea OPRITA, adresele retinute candva nu mai sunt folosite. */
  it('ignores the address cache while the option is off', async () => {
    localStorage.setItem('lumin-place-names-v2', JSON.stringify({
      '44.1143,24.9868': { address: 'Strada Carpați 68', locality: 'Roșiori de Vede' }
    }));
    const labels = await resolvePlaceLabels([{ key: 'g1', latitude: 44.11431, longitude: 24.98677 }], 'ro', near);
    expect(labels.has('g1')).toBe(false);
  });
});
