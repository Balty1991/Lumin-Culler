import { describe, it, expect, beforeEach } from 'vitest';
import { readProMode, writeProMode } from './proMode';

describe('proMode', () => {
  beforeEach(() => localStorage.clear());

  it('e oprit implicit — utilizatorul tinta e cel cu galeria plina', () => {
    expect(readProMode()).toBe(false);
  });

  it('alegerea supravietuieste unei reincarcari', () => {
    writeProMode(true);
    expect(readProMode()).toBe(true);
  });

  it('oprirea sterge urma, nu lasa un "0" in urma', () => {
    writeProMode(true);
    writeProMode(false);
    expect(readProMode()).toBe(false);
    expect(localStorage.getItem('lumin-pro-mode')).toBeNull();
  });

  it('o valoare straina in stocare nu porneste modul din greseala', () => {
    localStorage.setItem('lumin-pro-mode', 'da');
    expect(readProMode()).toBe(false);
  });
});
