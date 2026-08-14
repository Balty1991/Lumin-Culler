import { beforeEach, describe, it, expect } from 'vitest';
import { shouldShowSmartNotification, SMART_NOTIFICATION_INTERVAL_MS, readSmartNotificationLastShown } from './smartNotification';

describe('shouldShowSmartNotification', () => {
  it('never shows when disabled', () => {
    expect(shouldShowSmartNotification({ now: 1000, enabled: false, unsortedCount: 5, lastShown: null })).toBe(false);
  });

  it('never shows with nothing left to sort', () => {
    expect(shouldShowSmartNotification({ now: 1000, enabled: true, unsortedCount: 0, lastShown: null })).toBe(false);
  });

  it('shows the first time (no previous notification)', () => {
    expect(shouldShowSmartNotification({ now: 1000, enabled: true, unsortedCount: 5, lastShown: null })).toBe(true);
  });

  it('does not repeat before the daily interval has passed', () => {
    const now = 10_000_000;
    expect(shouldShowSmartNotification({ now, enabled: true, unsortedCount: 5, lastShown: now - 1000 })).toBe(false);
  });

  it('shows again once the interval has passed', () => {
    const now = 10_000_000;
    expect(shouldShowSmartNotification({
      now, enabled: true, unsortedCount: 5, lastShown: now - SMART_NOTIFICATION_INTERVAL_MS - 1
    })).toBe(true);
  });

  it('shows when caught up on sorting but a new gallery period is ready', () => {
    expect(shouldShowSmartNotification({
      now: 1000, enabled: true, unsortedCount: 0, hasNextPeriod: true, lastShown: null
    })).toBe(true);
  });

  it('still respects the daily interval for the next-period case', () => {
    const now = 10_000_000;
    expect(shouldShowSmartNotification({
      now, enabled: true, unsortedCount: 0, hasNextPeriod: true, lastShown: now - 1000
    })).toBe(false);
  });
});

/**
 * Aceeasi clasa de bug ca in backupReminder.test.ts. Aici efectul era ca
 * limitarea "cel mult o data pe zi" disparea complet: cu lastShown = NaN,
 * `now - NaN < INTERVAL` e fals, deci notificarea se arata la fiecare trecere.
 */
describe('smartNotification — marcaj de timp corupt in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('trateaza o valoare ne-numerica drept "niciodata aratata", nu drept NaN', () => {
    localStorage.setItem('lumin-smart-notification-last-shown', 'azi');
    expect(readSmartNotificationLastShown()).toBeNull();
  });

  it('un marcaj VALID pastreaza limitarea de o data pe zi', () => {
    localStorage.setItem('lumin-smart-notification-last-shown', '1000');
    expect(shouldShowSmartNotification({
      now: 1000 + SMART_NOTIFICATION_INTERVAL_MS - 1, enabled: true, unsortedCount: 5,
      lastShown: readSmartNotificationLastShown()
    })).toBe(false);
  });
});
