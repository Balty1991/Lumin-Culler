import { Capacitor, registerPlugin } from '@capacitor/core';
import { readPaywallLog, TRIAL_DAYS, type PaywallLogEntry } from './paywallMoment';

/**
 * lumin/trialReminder.ts
 * O notificare cu două zile înainte să se termine proba gratuită: când începe plata
 * și de unde se anulează. Fără ea, omul afla doar dacă deschidea aplicația în
 * ultimele două zile (cardul de pe Azi), iar o încasare-surpriză aduce rambursări
 * și recenzii de o stea. Atingerea deschide Azi, unde cardul spune restul.
 *
 * Folosește alarma capsulelor (aceeași notificare, alt id): capsulele au id-uri
 * 0–899, deci 950 nu se ciocnește cu niciuna.
 */
export const TRIAL_REMINDER_ID = 950;
const DAYS_BEFORE_END = 2;

interface AlarmApi {
  scheduleCapsule(o: { id: number; at: number; title: string; body: string }): Promise<void>;
}
const Native = registerPlugin<AlarmApi>('Notifications');
const nativeOk = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Notifications');

/** Când sună memento-ul pentru proba pornită la `startAt`: cu 2 zile înainte de final, la 10 dimineața. */
export function trialReminderTime(startAt: number): number {
  const d = new Date(startAt + (TRIAL_DAYS - DAYS_BEFORE_END) * 86_400_000);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

/**
 * Programează memento-ul pentru proba din jurnal, dacă mai e în viitor. Se cheamă după
 * pornirea probei și la fiecare pornire a aplicației (Android pierde alarmele la repornire).
 */
export function scheduleTrialReminder(
  text: { title: string; body: string },
  now = Date.now(),
  log: readonly PaywallLogEntry[] = readPaywallLog()
): number | null {
  const start = log.find(e => e.event === 'trial_started');
  if (!start) return null;
  const at = trialReminderTime(start.at);
  if (at <= now) return null;
  if (nativeOk()) void Native.scheduleCapsule({ id: TRIAL_REMINDER_ID, at, ...text }).catch(() => {});
  return at;
}
