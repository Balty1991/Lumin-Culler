import { describe, expect, it } from 'vitest';
import { MONTHLY_REMINDER_MS, SCREENSHOT_EXPIRE_MS, expiredShots, reminderDue, type AutoCleanSettings } from './autoClean';

const off: AutoCleanSettings = { monthlyReminder: false, expireScreenshots: false, lastMonthlyReminderAt: 0 };

describe('autoClean', () => {
  it('nu trimite memento cât timp comutatorul e oprit', () => {
    expect(reminderDue(off, 1_000)).toBe(false);
  });

  it('trimite la prima activare și apoi abia după o lună', () => {
    const on: AutoCleanSettings = { ...off, monthlyReminder: true };
    expect(reminderDue(on, 5_000)).toBe(true);
    const sent: AutoCleanSettings = { ...on, lastMonthlyReminderAt: 5_000 };
    expect(reminderDue(sent, 5_000 + MONTHLY_REMINDER_MS - 1)).toBe(false);
    expect(reminderDue(sent, 5_000 + MONTHLY_REMINDER_MS)).toBe(true);
  });

  it('expiră doar capturile mai vechi de 30 de zile, nu pe cele fără dată', () => {
    const now = 10_000_000_000;
    const shots = [
      { uri: 'old', taken: now - SCREENSHOT_EXPIRE_MS },
      { uri: 'new', taken: now - SCREENSHOT_EXPIRE_MS + 1 },
      { uri: 'undated', taken: 0 }
    ];
    expect(expiredShots(shots, now).map(s => s.uri)).toEqual(['old']);
  });
});
