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

export type Locale = 'ro' | 'en';

/**
 * Doar romana e legata static. Dictionarul englez (~119 KB de cod brut, cat
 * cel romanesc) se descarca la cerere — vezi ensureLocaleLoaded.
 *
 * De ce: cele doua dictionare erau amandoua in bundle-ul principal, desi
 * aplicatia foloseste exact unul la un moment dat. Adica fiecare pornire, la
 * orice utilizator, platea parsarea limbii pe care nu o are setata. Romana
 * ramane statica fiindca e si limba implicita, si plasa de rezerva a lui `t()`
 * cand o cheie lipseste — fara ea in bundle, un `t()` apelat inainte sa se fi
 * incarcat ceva n-ar avea ce returna.
 *
 * `en` porneste ca obiect gol, nu absent: `t()` il indexeaza direct, iar un
 * `undefined` acolo ar arunca in loc sa cada pe romana.
 */
const DICTS: Record<Locale, Record<string, string>> = { ro, en: {} };
const STORAGE_KEY = 'lumin-locale';

/** A intrat deja dictionarul englez in DICTS.en? (Romana e mereu prezenta.) */
let enLoaded = false;
/** Descarcarea in curs, ca doua apeluri simultane sa nu ceara modulul de doua ori. */
let enLoading: Promise<void> | null = null;

/**
 * Limba `locale` are dictionarul incarcat si `t()` poate raspunde in ea ACUM.
 *
 * Apelantii care schimba limba (store.setLocale) verifica intai asta: cand
 * raspunsul e da, comuta sincron, fara sa mai treaca printr-o promisiune —
 * altfel fiecare revenire la romana ar fi intarziat cu un tick degeaba.
 */
export function isLocaleLoaded(locale: Locale): boolean {
  return locale === 'ro' || enLoaded;
}

/**
 * Se asigura ca dictionarul limbii cerute e disponibil pentru `t()`.
 *
 * De apelat INAINTE de a arata ceva in acea limba: la pornire (main.tsx, pentru
 * limba salvata) si la comutarea din meniu. `t()` ramane sincron, deci nu are
 * cum sa astepte singur — daca s-ar randa mai devreme, un utilizator cu engleza
 * setata ar vedea o clipa interfata in romana.
 *
 * Un esec (offline, la prima pornire dupa instalare, cu chunk-ul necache-uit)
 * NU arunca: aplicatia porneste in romana, care e oricum plasa de rezerva a lui
 * `t()`. Mai bine interfata in limba gresita decat un ecran alb.
 */
export function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (locale !== 'en' || enLoaded) return Promise.resolve();
  enLoading ??= import('./en')
    .then(mod => { Object.assign(DICTS.en, mod.en); enLoaded = true; })
    .catch(err => {
      console.error('Dictionarul englez nu s-a putut incarca; ramane romana:', err);
      // Se reincearca la urmatorul apel (ex. urmatoarea comutare din meniu).
      enLoading = null;
    });
  return enLoading;
}

/**
 * Limba telefonului, cand utilizatorul n-a ales inca una.
 *
 * BUG REAL, gasit in raportul de testare extern: aplicatia pornea MEREU in
 * romana, indiferent de limba dispozitivului. Are traduceri englezesti complete
 * de mult timp, dar nu le folosea niciodata daca omul nu comuta manual din
 * meniu. Testerii au notat-o ca "app is offered primarily in one language" —
 * ceea ce, din afara, era exact adevarat.
 *
 * Conteaza pentru ca fisa din magazin merge in 177 de tari: un utilizator care
 * instaleaza cu telefonul in engleza deschidea o aplicatie in romana, fara sa
 * stie ca exista un comutator si fara sa poata citi meniul in care sta el.
 *
 * `navigator.languages` inaintea lui `navigator.language`: prima e lista
 * ordonata de preferinte a utilizatorului, si e cea corecta cand cineva are
 * romana pe locul doi.
 */
function deviceLocale(): Locale {
  try {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    if (!nav) return 'ro';
    const preferences = nav.languages?.length ? nav.languages : [nav.language];
    for (const tag of preferences) {
      if (typeof tag === 'string' && tag.toLowerCase().startsWith('ro')) return 'ro';
    }
    return 'en';
  } catch {
    return 'ro';
  }
}

/**
 * Limba de folosit: alegerea EXPLICITA a utilizatorului daca exista, altfel
 * limba telefonului.
 *
 * Consecinta de spus pe fata: cine avea deja aplicatia, n-a atins niciodata
 * comutatorul si are telefonul in engleza o va vedea de acum in engleza. E
 * schimbarea corecta — aplicatia urmeaza telefonul — dar e o schimbare, si
 * ramane la un tap distanta de revenit.
 */
export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ro' || stored === 'en') return stored;
  } catch {
    // stocare indisponibila — decide limba telefonului, ca la prima pornire
  }
  return deviceLocale();
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
