import { describe, expect, it } from 'vitest';
import { tameAfterLowLight, LIT_MAX_AMOUNT } from './Enhance';
import type { EditAdjustments } from '../core/imageAdjust';

describe('după lumina de pe telefon, corectura doar finisează', () => {
  it('taie lumina, contrastul și saturația adăugate peste', () => {
    const e = { exposure: 40, contrast: 30, saturation: 25, temperature: 5, tint: 0, highlights: 10, shadows: 35 } as EditAdjustments;
    tameAfterLowLight(e);
    expect(e.exposure).toBeLessThanOrEqual(6);
    expect(e.contrast).toBeLessThanOrEqual(8);
    expect(e.saturation).toBeLessThanOrEqual(0);
    expect(e.shadows).toBeLessThanOrEqual(10);
    expect(e.highlights).toBeLessThanOrEqual(0);
    expect(e.temperature).toBe(5);
  });
  it('lasă scăderile neatinse', () => {
    const e = { exposure: -10, contrast: -5, saturation: -20, temperature: 0, tint: 0, highlights: -30, shadows: 0 } as EditAdjustments;
    tameAfterLowLight(e);
    expect(e).toMatchObject({ exposure: -10, contrast: -5, saturation: -20, highlights: -30 });
    expect(LIT_MAX_AMOUNT).toBeLessThan(0.5);
  });
});
