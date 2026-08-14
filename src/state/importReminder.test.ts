import { beforeEach, describe, expect, it } from 'vitest';
import { shouldShowImportReminder, IMPORT_REMINDER_INTERVAL_MS, readImportReminderSnoozedUntil } from './importReminder';

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

/** Aceeasi clasa de bug ca in backupReminder.test.ts — vezi readFiniteNumber. */
describe('importReminder — "amana" corupt in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('trateaza o valoare ne-numerica drept absenta, in loc sa dezactiveze tacut amanarea prin NaN', () => {
    localStorage.setItem('lumin-import-reminder-snoozed-until', 'candva');
    expect(readImportReminderSnoozedUntil()).toBeNull();
  });

  it('o amanare VALIDA opreste in continuare memento-ul', () => {
    localStorage.setItem('lumin-import-reminder-snoozed-until', String(now + DAY));
    expect(shouldShowImportReminder({
      now, lastImportAt: now - 60 * DAY, snoozedUntil: readImportReminderSnoozedUntil()
    })).toBe(false);
  });
});
