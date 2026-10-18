/**
 * core/autoClean.ts
 * Obiceiul de curățare, fără un server care să țină minte programul.
 *
 * Ambele comutatoare sunt Premium. „Automat” nu înseamnă ștergere în tăcere:
 * mementoul lunar doar anunță, iar capturile mai vechi de 30 de zile intră
 * într-un coș pe care omul îl confirmă prin dialogul sistemului. O ștergere
 * pe care nu o vede nimeni e exact defectul pe care recenziile concurenților
 * îl descriu.
 */

export const SCREENSHOT_EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;
export const MONTHLY_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

const STORAGE_KEY = 'lumin-auto-clean';

export interface AutoCleanSettings {
  monthlyReminder: boolean;
  expireScreenshots: boolean;
  /** 0 = nu s-a trimis încă niciun memento. */
  lastMonthlyReminderAt: number;
}

export const AUTO_CLEAN_OFF: AutoCleanSettings = {
  monthlyReminder: false,
  expireScreenshots: false,
  lastMonthlyReminderAt: 0
};

export function readAutoClean(): AutoCleanSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...AUTO_CLEAN_OFF };
    const parsed = JSON.parse(raw) as Partial<AutoCleanSettings>;
    return {
      monthlyReminder: parsed.monthlyReminder === true,
      expireScreenshots: parsed.expireScreenshots === true,
      lastMonthlyReminderAt: typeof parsed.lastMonthlyReminderAt === 'number' && parsed.lastMonthlyReminderAt > 0
        ? parsed.lastMonthlyReminderAt
        : 0
    };
  } catch {
    return { ...AUTO_CLEAN_OFF };
  }
}

export function writeAutoClean(settings: AutoCleanSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // setarea ține cât sesiunea dacă ecranul o ține în memorie
  }
}

export function reminderDue(settings: AutoCleanSettings, now: number): boolean {
  if (!settings.monthlyReminder) return false;
  if (!settings.lastMonthlyReminderAt) return true;
  return now - settings.lastMonthlyReminderAt >= MONTHLY_REMINDER_MS;
}

/** Capturi suficient de vechi ca să intre în coșul de expirare. Fără dată, nu expiră. */
export function expiredShots<T extends { taken: number }>(items: readonly T[], now: number): T[] {
  return items.filter(item => item.taken > 0 && now - item.taken >= SCREENSHOT_EXPIRE_MS);
}
