import { describe, it, expect } from 'vitest';
import { reasonsFor } from './reasons';

describe('reasonsFor', () => {
  it('names the defects first', () => {
    const r = reasonsFor({ sharpness: 20, exposure: 50, faceCount: 1, allEyesOpen: false, bestSmile: 0.9 });
    expect(r.map(x => x.key)).toEqual(['lx.reason.eyesClosed', 'lx.reason.blurry', 'lx.reason.smile']);
  });

  it('praises a clean portrait', () => {
    const r = reasonsFor({ sharpness: 85, exposure: 50, faceCount: 2, allEyesOpen: true, bestSmile: 0.2 });
    expect(r.every(x => x.tone === 'good')).toBe(true);
  });
});
