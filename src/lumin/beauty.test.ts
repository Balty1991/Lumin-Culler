import { describe, expect, it } from 'vitest';
import { beautyScore } from './beauty';

describe('beautyScore', () => {
  it('fără model de gust: scorul estetic', () => {
    expect(beautyScore({ aesthetic: 6, aiScore: 50 })).toBe(6);
    expect(beautyScore({ aiScore: 60 })).toBe(5);
  });
  it('gustul omului mută ordinea', () => {
    const liked = beautyScore({ aesthetic: 5.5, aiScore: 0, tasteP: 0.95 });
    const pretty = beautyScore({ aesthetic: 6.2, aiScore: 0, tasteP: 0.2 });
    expect(liked).toBeGreaterThan(pretty);
  });
});
