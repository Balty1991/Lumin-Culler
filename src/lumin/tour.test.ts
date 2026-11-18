import { beforeEach, describe, expect, it } from 'vitest';
import { tourDue } from './tour';

const day = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();

describe('momentul turului', () => {
  beforeEach(() => localStorage.clear());

  it('nu apare în ziua primului import, cât omul n-a sortat', () => {
    expect(tourDue(0, day(18, 10))).toBe(false);
    expect(tourDue(0, day(18, 22))).toBe(false);
  });

  it('apare după prima sortare terminată', () => {
    expect(tourDue(0, day(18))).toBe(false);
    expect(tourDue(1, day(18))).toBe(true);
  });

  it('apare a doua zi, chiar fără sortare', () => {
    expect(tourDue(0, day(18))).toBe(false);
    expect(tourDue(0, day(19))).toBe(true);
  });
});
