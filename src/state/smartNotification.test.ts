import { beforeEach, describe, it, expect } from 'vitest';
import { shouldShowSmartNotification, SMART_NOTIFICATION_INTERVAL_MS, readSmartNotificationLastShown, readSmartNotificationEnabled, writeSmartNotificationEnabled, smartNotificationShown } from './smartNotification';

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

describe('pornite din start, oprite de cine nu le vrea', () => {
  beforeEach(() => localStorage.clear());

  it('fara nicio alegere facuta, sunt pornite', () => {
    // Erau opt-in, deci practic nimeni nu le vedea: comutatorul statea intr-o
    // sectiune pliata a meniului.
    expect(readSmartNotificationEnabled()).toBe(true);
  });

  it('cine le opreste, ramane cu ele oprite', () => {
    // Schimbarea implicitului n-are voie sa calce in picioare un refuz explicit.
    writeSmartNotificationEnabled(false);
    expect(readSmartNotificationEnabled()).toBe(false);
  });

  it('si le poate porni inapoi', () => {
    writeSmartNotificationEnabled(false);
    writeSmartNotificationEnabled(true);
    expect(readSmartNotificationEnabled()).toBe(true);
  });
});

describe('smartNotificationShown', () => {
  // Raportat de utilizator: comutatorul aparea PORNIT pe un telefon pe care
  // permisiunea nu fusese ceruta niciodata. "Oricum nu era funcțional, dar era
  // info eronat."
  it('pe Android, fara permisiune nu are voie sa arate pornit', () => {
    expect(smartNotificationShown(true, 'denied', true)).toBe(false);
    expect(smartNotificationShown(true, 'blocked', true)).toBe(false);
    expect(smartNotificationShown(true, 'unsupported', true)).toBe(false);
  });

  it('pe Android, cu permisiune data arata dorinta omului', () => {
    expect(smartNotificationShown(true, 'granted', true)).toBe(true);
    expect(smartNotificationShown(false, 'granted', true)).toBe(false);
  });

  it('un refuz nu porneste ceva ce omul a oprit', () => {
    expect(smartNotificationShown(false, 'denied', true)).toBe(false);
  });

  it('pe web ramane dorinta, oricare ar fi starea permisiunii', () => {
    // Acolo "nu s-a cerut inca" si "a fost refuzata" arata la fel, iar
    // permisiunea se cere la prima notificare reala — a stinge comutatorul ar
    // rupe degeaba "pornite din start".
    expect(smartNotificationShown(true, 'denied', false)).toBe(true);
    expect(smartNotificationShown(true, 'granted', false)).toBe(true);
    expect(smartNotificationShown(false, 'granted', false)).toBe(false);
  });
});
