import { describe, expect, it } from 'vitest';
import { thermalConcurrencyCap, THERMAL_MODERATE, THERMAL_THROTTLED_CONCURRENCY } from './thermalStatus';

/**
 * core/thermalStatus.test.ts
 * Regula termica, singura din modul care poate fi gresita fara sa dea eroare:
 * un plafon pus prea devreme incetineste importuri care mergeau bine, unul pus
 * prea tarziu nu apara nimic.
 *
 * Treptele sunt cele din PowerManager: NONE=0, LIGHT=1, MODERATE=2, SEVERE=3,
 * CRITICAL=4, EMERGENCY=5, SHUTDOWN=6.
 */
describe('plafonul de concurenta impus de temperatura', () => {
  it('la rece si la "usor" nu cere nimic — importul merge cum a fost masurat', () => {
    expect(thermalConcurrencyCap(0)).toBeNull();
    expect(thermalConcurrencyCap(1)).toBeNull();
  });

  it('de la "moderata" in sus coboara la doua poze in zbor', () => {
    expect(thermalConcurrencyCap(THERMAL_MODERATE)).toBe(THERMAL_THROTTLED_CONCURRENCY);
    expect(thermalConcurrencyCap(3)).toBe(THERMAL_THROTTLED_CONCURRENCY);
    expect(thermalConcurrencyCap(6)).toBe(THERMAL_THROTTLED_CONCURRENCY);
  });

  /**
   * "Nu se stie" nu inseamna "e rece" si nici "e cald": pe web si sub Android
   * 10 apelantul trebuie sa ramana exact cum era.
   */
  it('temperatura necunoscuta nu impune si nu ridica nimic', () => {
    expect(thermalConcurrencyCap(null)).toBeNull();
  });
});
