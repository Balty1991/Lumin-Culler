import { describe, it, expect } from 'vitest';
import { hasRealGps } from './gpsCoordinates';

describe('hasRealGps', () => {
  it('accepta coordonate obisnuite', () => {
    expect(hasRealGps(44.4268, 26.1025)).toBe(true);   // Bucuresti
    expect(hasRealGps(-33.8688, 151.2093)).toBe(true); // Sydney, ambele semne
    expect(hasRealGps(0, 26.1025)).toBe(true);         // pe ecuator, dar cu longitudine reala
  });

  /**
   * Bug real raportat de utilizator, cu captura: panoul arata
   * "Locatie GPS: 0.00000, 0.00000". Android lasa tag-urile GPS in EXIF cand
   * redacteaza locatia, doar le pune pe zero — pentru cod arata ca o citire
   * reusita.
   */
  it('respinge 0,0 — locatia stearsa de Android, nu un loc', () => {
    expect(hasRealGps(0, 0)).toBe(false);
  });

  it('respinge lipsa si valorile imposibile', () => {
    expect(hasRealGps(undefined, undefined)).toBe(false);
    expect(hasRealGps(44.4268, undefined)).toBe(false);
    expect(hasRealGps(undefined, 26.1025)).toBe(false);
    expect(hasRealGps(NaN, 26.1025)).toBe(false);
    expect(hasRealGps(91, 26.1025)).toBe(false);
    expect(hasRealGps(44.4268, 181)).toBe(false);
  });
});
