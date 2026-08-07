import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPremium, recordExport, exportsInRollingMonth, remainingFreeExports,
  canEnrollAnotherPersonFree, FREE_EXPORT_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS
} from './entitlement';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('entitlement (freemium local tracking)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isPremium() is false by default — no billing plugin has written the flag yet', () => {
    expect(isPremium()).toBe(false);
  });

  it('remainingFreeExports() starts at the full monthly allowance', () => {
    expect(remainingFreeExports()).toBe(FREE_EXPORT_PHOTOS_PER_MONTH);
  });

  it('recordExport() reduces the remaining free allowance by the recorded count', () => {
    const now = Date.now();
    recordExport(40, now);
    expect(exportsInRollingMonth(now)).toBe(40);
    expect(remainingFreeExports(now)).toBe(FREE_EXPORT_PHOTOS_PER_MONTH - 40);
  });

  it('never goes negative once the cap is exceeded', () => {
    const now = Date.now();
    recordExport(FREE_EXPORT_PHOTOS_PER_MONTH + 50, now);
    expect(remainingFreeExports(now)).toBe(0);
  });

  it('exports older than the 30-day rolling window no longer count against the cap', () => {
    const now = Date.now();
    recordExport(100, now - 31 * DAY_MS); // outside the window
    recordExport(20, now); // inside the window
    expect(exportsInRollingMonth(now)).toBe(20);
    expect(remainingFreeExports(now)).toBe(FREE_EXPORT_PHOTOS_PER_MONTH - 20);
  });

  it('ignores a non-positive count (nothing to record)', () => {
    recordExport(0);
    recordExport(-5);
    expect(exportsInRollingMonth()).toBe(0);
  });

  it('remainingFreeExports() is Infinity once premium is active, regardless of usage', () => {
    localStorage.setItem('lumin-premium', '1');
    recordExport(FREE_EXPORT_PHOTOS_PER_MONTH + 500);
    expect(remainingFreeExports()).toBe(Infinity);
  });

  describe('canEnrollAnotherPersonFree', () => {
    it('allows enrolling up to FREE_ENROLLED_PERSONS for free', () => {
      expect(canEnrollAnotherPersonFree(0)).toBe(true);
      expect(FREE_ENROLLED_PERSONS).toBeGreaterThan(0);
    });

    it('blocks (informationally) enrolling beyond the free limit for non-premium users', () => {
      expect(canEnrollAnotherPersonFree(FREE_ENROLLED_PERSONS)).toBe(false);
    });

    it('never limits a premium user, regardless of how many persons are already enrolled', () => {
      localStorage.setItem('lumin-premium', '1');
      expect(canEnrollAnotherPersonFree(999)).toBe(true);
    });
  });
});
