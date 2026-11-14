import { describe, expect, it } from 'vitest';
import { coverable } from './coverable';

describe('coverable', () => {
  it('o poză obișnuită poate fi copertă', () => {
    expect(coverable({ fileName: 'IMG_20261112_181200.jpg', sceneTags: ['child'] })).toBe(true);
  });
  it('capturile, documentele și pozele cu mult text nu', () => {
    expect(coverable({ fileName: 'Screenshot_20250301-101010_Lumin.jpg' })).toBe(false);
    expect(coverable({ fileName: 'DCIM/Screenshots/Screenshot_1.png' })).toBe(false);
    expect(coverable({ fileName: 'x.jpg', sceneTags: ['screenshot'] })).toBe(false);
    expect(coverable({ fileName: 'x.jpg', textCoverage: 0.2 })).toBe(false);
    expect(coverable({ fileName: 'x.jpg', aside: 'document' })).toBe(false);
  });
});
