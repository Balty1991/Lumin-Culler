import { describe, it, expect } from 'vitest';
import { streakOf } from './ritualStreak';

const DAY = 86_400_000;
const now = new Date(2026, 9, 28, 21, 0).getTime();
const day = (back: number) => new Date(2026, 9, 28 - back, 20, 0).getTime();

describe('streakOf', () => {
  it('is zero without finished days', () => {
    expect(streakOf([], now)).toBe(0);
  });

  it('counts consecutive days', () => {
    expect(streakOf([day(0), day(1), day(2)], now)).toBe(3);
  });

  it('forgives a single skipped day', () => {
    expect(streakOf([day(0), day(2), day(3)], now)).toBe(3);
  });

  it('breaks after two skipped days in a row', () => {
    expect(streakOf([day(0), day(3)], now)).toBe(1);
  });

  it('is zero when the last finished day is too old', () => {
    expect(streakOf([now - 4 * DAY], now)).toBe(0);
  });

  it('counts the same day once', () => {
    expect(streakOf([day(0), day(0) + 1000], now)).toBe(1);
  });
});
