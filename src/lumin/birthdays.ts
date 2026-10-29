
import { intlTag } from '../i18n';/**
 * lumin/birthdays.ts
 * Zilele de naștere ale oamenilor numiți: cu câteva zile înainte, Cherrypic
 * propune un colaj cu persoana din ultimul an, gata de trimis. Ținute pe
 * telefon (localStorage), pe nume; nu pleacă nicăieri.
 */
export interface Birthday { month: number; day: number; year?: number }
const KEY = 'lumin-birthdays';
const DAY = 86_400_000;

export function readBirthdays(): Record<string, Birthday> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Birthday>; } catch { return {}; }
}

export function writeBirthday(name: string, b: Birthday | null): void {
  const all = readBirthdays();
  if (b) all[name] = b; else delete all[name];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

/** „12.03”, „12/3”, „12.03.2020” → ziua; altceva → null. */
export function parseBirthday(raw: string): Birthday | null {
  const m = raw.trim().match(/^(\d{1,2})[./\-\s](\d{1,2})(?:[./\-\s](\d{4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? Number(m[3]) : undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (new Date(2024, month - 1, day).getDate() !== day) return null; // 31.02 nu există (2024: și 29.02)
  if (year !== undefined && (year < 1900 || year > new Date().getFullYear())) return null;
  return { month, day, ...(year ? { year } : {}) };
}

export function formatBirthday(b: Birthday, locale: string): string {
  return new Date(2024, b.month - 1, b.day).toLocaleDateString(intlTag(locale), { day: 'numeric', month: 'long' });
}

/** În câte zile e următoarea zi de naștere (0 = azi) și câți ani împlinește, dacă știm anul. */
export function nextBirthday(b: Birthday, now: number = Date.now()): { days: number; turns?: number } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  let next = new Date(year, b.month - 1, b.day);
  if (next.getTime() < today.getTime()) { year++; next = new Date(year, b.month - 1, b.day); }
  const days = Math.round((next.getTime() - today.getTime()) / DAY);
  return { days, ...(b.year ? { turns: year - b.year } : {}) };
}
