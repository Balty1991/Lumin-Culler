import { describe, it, expect } from 'vitest';
import { sumKnownSizeBytes, formatGB } from './storageStats';
import type { PhotoView } from './store';

function photo(id: string, sizeBytes: number | undefined): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], sizeBytes
  };
}

describe('sumKnownSizeBytes', () => {
  it('sums known sizes', () => {
    expect(sumKnownSizeBytes([photo('a', 1000), photo('b', 2000)])).toBe(3000);
  });

  it('excludes photos without a known size (does not treat as 0)', () => {
    expect(sumKnownSizeBytes([photo('a', 1000), photo('b', undefined)])).toBe(1000);
  });

  it('returns 0 for an empty library', () => {
    expect(sumKnownSizeBytes([])).toBe(0);
  });
});

describe('formatGB', () => {
  it('formats bytes as GB with one decimal', () => {
    expect(formatGB(1.2 * 1024 ** 3)).toBe('1.2');
  });

  it('formats 0 bytes as 0.0', () => {
    expect(formatGB(0)).toBe('0.0');
  });
});
