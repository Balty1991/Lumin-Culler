import { describe, expect, it } from 'vitest';
import { stepSpring } from './orbPhysics';
import { accentFromPixels, inkForAccent } from './palette';
import { addFreedBytes, readFreedBytes, subtractFreedBytes } from '../state/storageFreed';

describe('orb spring', () => {
  it('urcă spre țintă și se liniștește', () => {
    let spring = { value: 0.1, velocity: 0 };
    for (let i = 0; i < 180; i++) spring = stepSpring(spring, 0.8, 1 / 60);
    expect(spring.value).toBeGreaterThan(0.75);
    expect(spring.value).toBeLessThan(0.85);
    expect(Math.abs(spring.velocity)).toBeLessThan(0.05);
  });
});

describe('accent din poză', () => {
  it('alege roșul saturat, nu griul', () => {
    const data = new Uint8ClampedArray(8 * 4);
    for (let i = 0; i < 4; i++) {
      data[i * 4] = 220;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 255;
    }
    for (let i = 4; i < 8; i++) {
      data[i * 4] = 20;
      data[i * 4 + 1] = 20;
      data[i * 4 + 2] = 20;
      data[i * 4 + 3] = 255;
    }
    const accent = accentFromPixels(data);
    expect(accent.startsWith('#')).toBe(true);
    expect(accent.slice(1, 3) > accent.slice(3, 5)).toBe(true);
    expect(inkForAccent('#f4f7ff')).toBe('#12141c');
    expect(inkForAccent('#102018')).toBe('#f4f7ff');
  });
});

describe('undo pe spațiul eliberat', () => {
  it('scade exact octeții puși înapoi', () => {
    localStorage.clear();
    addFreedBytes(500);
    expect(subtractFreedBytes(200)).toBe(300);
    expect(readFreedBytes()).toBe(300);
    expect(subtractFreedBytes(900)).toBe(0);
  });
});
