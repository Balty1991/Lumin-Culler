import { describe, expect, it } from 'vitest';
import { liftFor } from './Enhance';

describe('liftFor', () => {
  it('fețele întunecate primesc mai multă lumină, cele luminoase deloc', () => {
    expect(liftFor(0.4, true)).toBe(24);
    expect(liftFor(0.5, true)).toBeGreaterThan(10);
    expect(liftFor(0.7, true)).toBe(0);
  });
  it('fără fețe, după toată poza; o poză deja luminoasă rămâne la fel', () => {
    expect(liftFor(0.35, false)).toBeGreaterThan(12);
    expect(liftFor(0.6, false)).toBe(0);
  });
});
