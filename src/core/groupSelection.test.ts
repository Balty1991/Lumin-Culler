import { describe, expect, it } from 'vitest';
import { pickBestInGroup, type GroupCandidate } from './groupSelection';

function candidate(overrides: Partial<GroupCandidate>): GroupCandidate {
  return {
    id: 'p', sharpness: 50, exposure: 50, faceCount: 0, bestSmile: 0, allEyesOpen: true,
    ...overrides
  };
}

describe('pickBestInGroup', () => {
  it('throws on an empty group', () => {
    expect(() => pickBestInGroup([])).toThrow();
  });

  it('returns the only candidate for a single-member group', () => {
    expect(pickBestInGroup([candidate({ id: 'a' })])).toBe('a');
  });

  it('prefers the sharper frame when other factors are equal', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blurry', sharpness: 20 }),
      candidate({ id: 'sharp', sharpness: 90 })
    ]);
    expect(result).toBe('sharp');
  });

  it('prefers balanced exposure over an over/under-exposed frame', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blown-out', sharpness: 80, exposure: 98 }),
      candidate({ id: 'balanced', sharpness: 80, exposure: 50 })
    ]);
    expect(result).toBe('balanced');
  });

  it('penalizes a blinking subject vs. one with eyes open, all else equal', () => {
    const result = pickBestInGroup([
      candidate({ id: 'blinking', faceCount: 1, allEyesOpen: false, bestSmile: 0.8 }),
      candidate({ id: 'eyes-open', faceCount: 1, allEyesOpen: true, bestSmile: 0.8 })
    ]);
    expect(result).toBe('eyes-open');
  });

  it('uses groupEyesOpenRatio (not just allEyesOpen) for multi-face frames', () => {
    const result = pickBestInGroup([
      candidate({ id: 'half-closed', faceCount: 3, allEyesOpen: false, groupEyesOpenRatio: 0.33 }),
      candidate({ id: 'mostly-open', faceCount: 3, allEyesOpen: false, groupEyesOpenRatio: 0.66 })
    ]);
    expect(result).toBe('mostly-open');
  });

  it('rewards a higher compositionScore when technical quality is tied', () => {
    const result = pickBestInGroup([
      candidate({ id: 'weak-comp', sharpness: 80, exposure: 50, compositionScore: 0.2 }),
      candidate({ id: 'strong-comp', sharpness: 80, exposure: 50, compositionScore: 0.9 })
    ]);
    expect(result).toBe('strong-comp');
  });
});

// Ce a invatat motorul din deciziile utilizatorului cantareste si el la alegerea
// cadrului din serie — proportional cu cat de antrenat e (ContextEngine.learnedWeight).
describe('pickBestInGroup cu scorul invatat', () => {
  it('ignora complet aiScore cat timp motorul nu a invatat nimic (learnedWeight 0)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 90, aiScore: 10 }),
      candidate({ id: 'neclar', sharpness: 20, aiScore: 99 })
    ]);
    expect(result).toBe('clar');
  });

  it('lasa scorul invatat sa decida cand motorul e antrenat, la diferente mici de calitate', () => {
    const result = pickBestInGroup([
      candidate({ id: 'a', sharpness: 60, aiScore: 20 }),
      candidate({ id: 'b', sharpness: 55, aiScore: 95 })
    ], 1);
    expect(result).toBe('b');
  });

  it('nu lasa scorul invatat sa salveze un cadru vizibil neclar (amestec, nu inlocuire)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 100, aiScore: 50 }),
      candidate({ id: 'foarte-neclar', sharpness: 0, aiScore: 80 })
    ], 0.5);
    expect(result).toBe('clar');
  });

  it('se comporta ca inainte cand candidatii nu au aiScore deloc (web/inregistrari vechi)', () => {
    const result = pickBestInGroup([
      candidate({ id: 'clar', sharpness: 90 }),
      candidate({ id: 'neclar', sharpness: 20 })
    ], 1);
    expect(result).toBe('clar');
  });
});
