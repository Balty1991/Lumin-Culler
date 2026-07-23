import { describe, expect, it } from 'vitest';
import { generateXMPSidecar } from './xmpGenerator';

describe('generateXMPSidecar', () => {
  it('uses the manual star rating when present', () => {
    expect(generateXMPSidecar('selected', 3)).toContain('xmp:Rating="3"');
  });

  it('falls back to the status convention when no manual rating exists', () => {
    expect(generateXMPSidecar('selected')).toContain('xmp:Rating="5"');
    expect(generateXMPSidecar('review')).toContain('xmp:Rating="0"');
  });

  it('ignores a 0 rating (treated as "no rating"), falling back to the status convention', () => {
    expect(generateXMPSidecar('selected', 0)).toContain('xmp:Rating="5"');
  });

  it('a rejected photo always gets -1, even with a leftover star rating', () => {
    const xmp = generateXMPSidecar('rejected', 4);
    expect(xmp).toContain('xmp:Rating="-1"');
    expect(xmp).not.toContain('xmp:Rating="4"');
  });

  it('always writes the status color label regardless of rating', () => {
    expect(generateXMPSidecar('selected', 2)).toContain('xmp:Label="Green"');
    expect(generateXMPSidecar('rejected', 2)).toContain('xmp:Label="Red"');
  });
});
