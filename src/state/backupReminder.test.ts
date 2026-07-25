import { describe, expect, it } from 'vitest';
import { shouldShowBackupReminder, BACKUP_REMINDER_INTERVAL_MS } from './backupReminder';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 15);

describe('shouldShowBackupReminder', () => {
  it('never shows when there is nothing worth backing up', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: false, now, lastBackupAt: null, snoozedUntil: null, earliestActivityAt: now - 10 * DAY
    })).toBe(false);
  });

  it('stays quiet during the grace period before the first backup ever', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: null, snoozedUntil: null, earliestActivityAt: now - 1 * DAY
    })).toBe(false);
  });

  it('shows once the grace period has passed and no backup was ever made', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: null, snoozedUntil: null, earliestActivityAt: now - 4 * DAY
    })).toBe(true);
  });

  it('stays quiet when there is no known activity at all yet', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: null, snoozedUntil: null, earliestActivityAt: null
    })).toBe(false);
  });

  it('stays quiet shortly after a recent backup', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: now - 2 * DAY, snoozedUntil: null, earliestActivityAt: now - 30 * DAY
    })).toBe(false);
  });

  it('shows again once the reminder interval has elapsed since the last backup', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: now - BACKUP_REMINDER_INTERVAL_MS - DAY, snoozedUntil: null, earliestActivityAt: now - 60 * DAY
    })).toBe(true);
  });

  it('stays quiet while snoozed, even if otherwise due', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: now - BACKUP_REMINDER_INTERVAL_MS - DAY, snoozedUntil: now + DAY, earliestActivityAt: now - 60 * DAY
    })).toBe(false);
  });

  it('shows again once the snooze period has elapsed', () => {
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: now - BACKUP_REMINDER_INTERVAL_MS - DAY, snoozedUntil: now - 1, earliestActivityAt: now - 60 * DAY
    })).toBe(true);
  });
});
