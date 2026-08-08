import { describe, expect, it } from 'vitest';
import { shouldShowImportReminder, IMPORT_REMINDER_INTERVAL_MS } from './importReminder';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 15);

describe('shouldShowImportReminder', () => {
  it('never shows for a user who has never imported anything (nothing to sort yet)', () => {
    expect(shouldShowImportReminder({ now, lastImportAt: null, snoozedUntil: null })).toBe(false);
  });

  it('stays quiet shortly after a recent import', () => {
    expect(shouldShowImportReminder({ now, lastImportAt: now - 2 * DAY, snoozedUntil: null })).toBe(false);
  });

  it('shows once the reminder interval has elapsed since the last import', () => {
    expect(shouldShowImportReminder({ now, lastImportAt: now - IMPORT_REMINDER_INTERVAL_MS - DAY, snoozedUntil: null })).toBe(true);
  });

  it('shows exactly at the interval boundary', () => {
    expect(shouldShowImportReminder({ now, lastImportAt: now - IMPORT_REMINDER_INTERVAL_MS, snoozedUntil: null })).toBe(true);
  });

  it('stays quiet while snoozed, even if otherwise due', () => {
    expect(shouldShowImportReminder({
      now, lastImportAt: now - IMPORT_REMINDER_INTERVAL_MS - DAY, snoozedUntil: now + DAY
    })).toBe(false);
  });

  it('shows again once the snooze period has elapsed', () => {
    expect(shouldShowImportReminder({
      now, lastImportAt: now - IMPORT_REMINDER_INTERVAL_MS - DAY, snoozedUntil: now - 1
    })).toBe(true);
  });
});
