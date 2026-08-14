import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPremium, recordPhotosUsed, photosUsedInRollingMonth, remainingFreePhotos,
  canEnrollAnotherPersonFree, isPremiumFeatureLocked, FREE_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS
} from './entitlement';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('entitlement (freemium local tracking)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isPremium() is false by default — no billing plugin has written the flag yet', () => {
    expect(isPremium()).toBe(false);
  });

  it('remainingFreePhotos() starts at the full monthly allowance', () => {
    expect(remainingFreePhotos()).toBe(FREE_PHOTOS_PER_MONTH);
  });

  it('recordPhotosUsed() reduces the remaining free allowance by the recorded count', () => {
    const now = Date.now();
    recordPhotosUsed(40, now);
    expect(photosUsedInRollingMonth(now)).toBe(40);
    expect(remainingFreePhotos(now)).toBe(FREE_PHOTOS_PER_MONTH - 40);
  });

  it('never goes negative once the cap is exceeded', () => {
    const now = Date.now();
    recordPhotosUsed(FREE_PHOTOS_PER_MONTH + 50, now);
    expect(remainingFreePhotos(now)).toBe(0);
  });

  it('exports older than the 30-day rolling window no longer count against the cap', () => {
    const now = Date.now();
    recordPhotosUsed(100, now - 31 * DAY_MS); // outside the window
    recordPhotosUsed(20, now); // inside the window
    expect(photosUsedInRollingMonth(now)).toBe(20);
    expect(remainingFreePhotos(now)).toBe(FREE_PHOTOS_PER_MONTH - 20);
  });

  it('ignores a non-positive count (nothing to record)', () => {
    recordPhotosUsed(0);
    recordPhotosUsed(-5);
    expect(photosUsedInRollingMonth()).toBe(0);
  });

  it('remainingFreePhotos() is Infinity once premium is active, regardless of usage', () => {
    localStorage.setItem('lumin-premium', '1');
    recordPhotosUsed(FREE_PHOTOS_PER_MONTH + 500);
    expect(remainingFreePhotos()).toBe(Infinity);
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

describe('isPremiumFeatureLocked', () => {
  beforeEach(() => localStorage.clear());

  // Regula care deosebeste un model freemium de un perete: nu blocam nimic cat
  // timp utilizatorul n-are de unde cumpara.
  it('nu blocheaza nimic cat timp Play n-a confirmat ca exista ce cumpara', () => {
    expect(isPremiumFeatureLocked()).toBe(false);
  });

  it('blocheaza cand abonamentul e cumparabil si utilizatorul nu e abonat', () => {
    localStorage.setItem('lumin-billing-ready', '1');
    expect(isPremiumFeatureLocked()).toBe(true);
  });

  it('nu blocheaza un abonat', () => {
    localStorage.setItem('lumin-billing-ready', '1');
    localStorage.setItem('lumin-premium', '1');
    expect(isPremiumFeatureLocked()).toBe(false);
  });
});
