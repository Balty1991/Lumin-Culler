import { describe, it, expect } from 'vitest';
import { passesNow } from './useLxPhotos';

describe('ritmul listei de poze spre ecran', () => {
  it('în afara citirii, orice schimbare trece pe loc', () => {
    expect(passesNow(false, false, 0)).toBe(true);
  });
  it('în timpul citirii, decizia omului trece pe loc, pozele noi așteaptă', () => {
    expect(passesNow(true, true, 10)).toBe(true);
    expect(passesNow(true, false, 10)).toBe(false);
    expect(passesNow(true, false, 2500)).toBe(true);
  });
});
