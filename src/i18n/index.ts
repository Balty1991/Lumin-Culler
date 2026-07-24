/**
 * i18n/index.ts
 * Infrastructura de localizare (plan Faza 2, "Localizare si Expansiune Globala").
 * Migrare TREPTATA: doar ecranele efectiv migrate (vezi ro.ts/en.ts) au chei aici —
 * restul aplicatiei ramane in romana codificata direct in JSX, ca inainte. `t()`
 * cade pe romana daca o cheie lipseste (nu ar trebui sa se intample, `en` e tipat
 * ca Record complet fata de cheile din `ro`, dar o cheie STRAINA data din greseala
 * la apel tot are un fallback rezonabil in loc sa arunce).
 *
 * Locale traieste in Zustand (state/store.ts), nu doar intr-o variabila de modul —
 * componentele trebuie sa citeasca `useStore(s => s.locale)` ca sa se re-randeze
 * la schimbarea limbii; `t()` ramane o functie pura care primeste locale explicit.
 */
import { ro } from './ro';
import { en } from './en';

export type Locale = 'ro' | 'en';

const DICTS: Record<Locale, Record<string, string>> = { ro, en };
const STORAGE_KEY = 'lumin-locale';

export function readStoredLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ro';
  } catch {
    return 'ro';
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — limba tot se aplica pentru sesiunea curenta
  }
}

/** Actualizeaza atributul lang de pe &lt;html&gt; — WCAG 3.1.1 (Language of Page): fara asta,
    cititoarele de ecran continua sa foloseasca regulile de pronuntie ale limbii initiale
    (romana, din index.html) chiar si dupa ce interfata a comutat pe engleza. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}

/** Traduce o cheie in limba data, cu interpolare simpla `{param}` -> valoare. */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let str = DICTS[locale][key] ?? DICTS.ro[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) str = str.split(`{${k}}`).join(String(v));
  }
  return str;
}

/**
 * Doar 2 forme (singular/plural) — vocabularul deja folosit in aplicatie (ex. "poza"/"poze")
 * nu are nevoie de forma "few" distincta din CLDR romana ("poze" ramane neschimbat
 * si la 2, si la 20+), iar engleza oricum are doar 2 forme.
 */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}
