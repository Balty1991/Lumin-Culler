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

/**
 * Cand un numar cere particula "de" inaintea substantivului, in romana.
 *
 * "2 poze", dar "20 DE poze". Regula nu e "peste 20": conteaza ultimele doua
 * cifre. 101 ramane "101 poze", fiindca 101 se termina in 1..19; 120 devine
 * "120 de poze". Iar 100 cere "de", fiindca se termina in 00.
 *
 * Sunt exact clasele "few" si "other" din CLDR pentru romana. Nu le-am inventat
 * eu si nu se aplica englezei, unde numarul sta singur langa substantiv.
 */
export function necesitaDe(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const intreg = Math.abs(Math.trunc(n));
  if (intreg === 0 || intreg === 1) return false;
  const ultimeleDoua = intreg % 100;
  return !(ultimeleDoua >= 1 && ultimeleDoua <= 19);
}

/**
 * Traduce o cheie in limba data, cu interpolare simpla `{param}` -> valoare.
 *
 * Pe langa parametrii primiti, pune la dispozitie si `{countDe}`: acelasi numar
 * ca `{count}`, dar cu "de" lipit dupa el cand gramatica romaneasca o cere.
 * Textele romanesti in care dupa numar urmeaza un substantiv folosesc
 * `{countDe}`; cele englezesti raman pe `{count}`, unde nu exista particula.
 *
 * De ce asa si nu o a treia forma in dictionar: intre "few" si "other", in
 * romana, SUBSTANTIVUL nu se schimba deloc ("2 poze", "20 de poze"). Singura
 * diferenta e particula. O a treia forma pentru fiecare cheie ar fi insemnat
 * sute de siruri duplicate ca sa exprime un singur cuvant.
 */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let str = DICTS[locale][key] ?? DICTS.ro[key] ?? key;
  if (params) {
    const count = params.count;
    if (typeof count === 'number') {
      // `{countDe}` nu contine `{count}` ca subsir (dupa "count" urmeaza "D",
      // nu acolada), deci ordinea inlocuirilor nu conteaza.
      params = { ...params, countDe: locale === 'ro' && necesitaDe(count) ? `${count} de` : String(count) };
    }
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
