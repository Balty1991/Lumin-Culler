import { describe, it, expect } from 'vitest';
import { shouldShowSmartNotification, SMART_NOTIFICATION_INTERVAL_MS } from './smartNotification';

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
});
