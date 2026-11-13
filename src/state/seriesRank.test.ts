import { describe, expect, it } from 'vitest';
import { seriesRank } from './store';

describe('seriesRank — cea mai bună poză de grup', () => {
  it('la grup, ochii deschiși bat scorul AI', () => {
    const closed = { aiScore: 90, faceCount: 3, allEyesOpen: false, bestSmile: 0.9 };
    const open = { aiScore: 70, faceCount: 3, allEyesOpen: true, bestSmile: 0.5 };
    expect([closed, open].sort(seriesRank)[0]).toBe(open);
  });
  it('apoi zâmbetul, când diferența e clară', () => {
    const a = { aiScore: 80, faceCount: 2, allEyesOpen: true, bestSmile: 0.2 };
    const b = { aiScore: 60, faceCount: 2, allEyesOpen: true, bestSmile: 0.8 };
    expect([a, b].sort(seriesRank)[0]).toBe(b);
  });
  it('o singură față, scoruri apropiate: ochii deschiși câștigă', () => {
    const a = { aiScore: 80, faceCount: 1, allEyesOpen: false };
    const b = { aiScore: 60, faceCount: 1, allEyesOpen: true };
    expect([a, b].sort(seriesRank)[0]).toBe(b);
  });

  it('o singură față, scor mult mai bun: scorul AI', () => {
    const a = { aiScore: 90, faceCount: 1, allEyesOpen: false };
    const b = { aiScore: 50, faceCount: 1, allEyesOpen: true };
    expect([b, a].sort(seriesRank)[0]).toBe(a);
  });
});
