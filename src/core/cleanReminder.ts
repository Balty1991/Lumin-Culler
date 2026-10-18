/**
 * core/cleanReminder.ts
 * Mementoul lunar, programat de WorkManager ca să apară și când aplicația
 * nu e deschisă. Nu șterge nimic: notificarea spune cât e de curățat, iar
 * omul confirmă în dialogul sistemului.
 *
 * Pe web plugin-ul lipsește. Acolo rămâne mementoul de la deschiderea
 * ecranului (autoClean.ts).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface CleanReminderSchedule {
  intervalDays: number;
  locale: string;
  reclaimableBytes: number;
  /** true doar când se schimbă intervalul: altfel programarea existentă rămâne, ca să nu se tot amâne luna. */
  reset: boolean;
}

interface CleanReminderPluginApi {
  schedule(options: CleanReminderSchedule): Promise<void>;
  cancel(): Promise<void>;
  shouldShow(options: { intervalDays: number }): Promise<{ due: boolean }>;
  markShown(): Promise<void>;
}

const CleanReminderNative = registerPlugin<CleanReminderPluginApi>('CleanReminder');

export function isCleanReminderAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CleanReminder');
}

export async function scheduleCleanReminder(options: CleanReminderSchedule): Promise<void> {
  if (!isCleanReminderAvailable()) return;
  try { await CleanReminderNative.schedule(options); } catch { /* programarea e un plus, nu o condiție */ }
}

export async function cancelCleanReminder(): Promise<void> {
  if (!isCleanReminderAvailable()) return;
  try { await CleanReminderNative.cancel(); } catch { /* la fel */ }
}

/** null = nu avem ce întreba (web). false = worker-ul a anunțat deja în intervalul ăsta. */
export async function cleanReminderIsDue(intervalDays: number): Promise<boolean | null> {
  if (!isCleanReminderAvailable()) return null;
  try {
    const result = await CleanReminderNative.shouldShow({ intervalDays });
    return result.due === true;
  } catch {
    return null;
  }
}

export async function markCleanReminderShown(): Promise<void> {
  if (!isCleanReminderAvailable()) return;
  try { await CleanReminderNative.markShown(); } catch { /* ceasul local rămâne */ }
}
