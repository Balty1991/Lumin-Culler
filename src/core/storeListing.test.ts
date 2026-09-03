import { describe, expect, it, vi } from 'vitest';
import { openStoreListing, STORE_URL_WEB, APP_ID } from './storeListing';

/**
 * core/storeListing.test.ts
 * Butonul care duce spre recenzii. Ce se poate strica aici nu da eroare: duce
 * pur si simplu nicaieri, pe telefoanele fara Play — adica exact acolo unde
 * utilizatorul ar fi ramas fara nicio cale, ceea ce era problema de la inceput.
 */
describe('openStoreListing', () => {
  it('incearca intai aplicatia Play, ca sa nu treaca prin browser degeaba', () => {
    const open = vi.fn(() => ({}) as Window);
    expect(openStoreListing(open)).toBe(`market://details?id=${APP_ID}`);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('cade pe adresa web cand sistemul nu cunoaste schema market://', () => {
    // Pe web/PWA si pe telefoanele fara Play Store, `window.open('market://…')`
    // intoarce null. Fara aceasta cale, butonul n-ar face absolut nimic.
    const open = vi.fn((url: string) => (url.startsWith('market:') ? null : ({} as Window)));
    expect(openStoreListing(open)).toBe(STORE_URL_WEB);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('cade pe adresa web si cand incercarea nativa ARUNCA', () => {
    const open = vi.fn((url: string) => {
      if (url.startsWith('market:')) throw new Error('schema necunoscuta');
      return {} as Window;
    });
    expect(openStoreListing(open)).toBe(STORE_URL_WEB);
  });

  it('adresa web contine identificatorul real al aplicatiei', () => {
    // Acelasi id ca in capacitor.config.ts si android/app/build.gradle — un id
    // gresit ar duce utilizatorul la pagina altcuiva, sau la niciuna.
    expect(APP_ID).toBe('com.luminculler.app');
    expect(STORE_URL_WEB).toContain(`id=${APP_ID}`);
  });
});
