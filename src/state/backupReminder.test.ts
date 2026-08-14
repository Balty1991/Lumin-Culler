import { beforeEach, describe, expect, it } from 'vitest';
import { shouldShowBackupReminder, BACKUP_REMINDER_INTERVAL_MS, readLastBackupAt, readSnoozedUntil } from './backupReminder';

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

/**
 * Bug real gasit de auditul QA — vezi readFiniteNumber in backupReminder.ts.
 * `raw ? Number(raw) : null` intorcea NaN pentru orice continut ne-numeric,
 * iar NaN nu e null: trecea de gardele `!== null` si apoi orice comparatie cu
 * el era falsa, deci "amana 7 zile" devenea invizibil si bannerul reaparea
 * imediat dupa ce utilizatorul tocmai il amanase.
 */
describe('backupReminder — citiri numerice din localStorage corupte', () => {
  beforeEach(() => localStorage.clear());

  it('trateaza o valoare ne-numerica drept absenta (null), nu drept NaN', () => {
    localStorage.setItem('lumin-last-backup-at', 'ieri');
    localStorage.setItem('lumin-backup-reminder-snoozed-until', '{}');
    expect(readLastBackupAt()).toBeNull();
    expect(readSnoozedUntil()).toBeNull();
  });

  it('respinge Infinity si sirul gol la fel ca orice alta valoare invalida', () => {
    localStorage.setItem('lumin-last-backup-at', 'Infinity');
    expect(readLastBackupAt()).toBeNull();
    localStorage.setItem('lumin-last-backup-at', '');
    expect(readLastBackupAt()).toBeNull();
  });

  it('un "amana" corupt nu mai ascunde bannerul si nici nu-l face permanent — se comporta ca si cum n-ar exista', () => {
    localStorage.setItem('lumin-backup-reminder-snoozed-until', 'nu-e-numar');
    expect(shouldShowBackupReminder({
      hasDataWorthBackingUp: true, now, lastBackupAt: now - 30 * DAY,
      snoozedUntil: readSnoozedUntil(), earliestActivityAt: now - 60 * DAY
    })).toBe(true);
  });

  it('citeste normal o valoare valida (inclusiv 0, epoch)', () => {
    localStorage.setItem('lumin-last-backup-at', '0');
    expect(readLastBackupAt()).toBe(0);
    localStorage.setItem('lumin-last-backup-at', String(now));
    expect(readLastBackupAt()).toBe(now);
  });
});
