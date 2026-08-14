/**
 * core/entitlement.ts
 * Fundatia LOCALA a modelului freemium: TRIAJUL e gratuit la nesfarsit —
 * import, scor AI, sortare, grupare, oricate poze. Se plateste pentru ce faci
 * cu rezultatul: pentru pozele SCOASE din aplicatie peste un plafon lunar
 * generos (exportate sau sterse din telefon — vezi FREE_PHOTOS_PER_MONTH),
 * pentru a doua persoana recunoscuta, si pentru functiile de dupa triaj (vezi
 * isPremiumFeatureLocked).
 *
 * Sursa de adevar e Google Play, nu acest fisier: refreshEntitlement() intreaba
 * plugin-ul de billing si scrie raspunsul in PREMIUM_FLAG_KEY. isPremium()
 * ramane SINCRON si citeste doar cache-ul acela — altfel fiecare apelant
 * (state/store.ts, PersonsPanel, SessionOutcome) ar fi trebuit sa devina async
 * pentru o intrebare la care raspunsul se schimba de cateva ori pe an.
 *
 * De ce se pastreaza ultima stare cunoscuta: verificarea are nevoie de retea.
 * Fara cache, un abonat care deschide aplicatia in avion ar fi tratat ca
 * neabonat pana la urmatoarea conexiune. Cache-ul se actualizeaza doar cand Play
 * chiar RASPUNDE — un esec de retea nu sterge niciodata un abonament valid.
 *
 * Ce NU face: validare de chitanta pe server. Aplicatia n-are server, si a
 * adauga unul ar contrazice direct promisiunea ca nimic nu pleaca de pe telefon.
 * Un flag din localStorage e falsificabil de cine vrea neaparat; pentru un
 * abonament de consum la o aplicatie locala, ala e compromisul corect.
 */

import { isBillingAvailable, queryPremiumActive, queryPremiumPrice } from './billing';

const PREMIUM_FLAG_KEY = 'lumin-premium';
/** Play a confirmat cel putin o data ca abonamentul chiar poate fi cumparat — vezi isPurchasable(). */
const PURCHASABLE_KEY = 'lumin-billing-ready';
/** Numele cheii ramane cel vechi ca sa nu se piarda contorul celor care au deja aplicatia. */
const USAGE_LOG_KEY = 'lumin-export-log';

/**
 * Cate poze poate SCOATE gratuit un utilizator neabonat dintr-o fereastra
 * glisanta de 30 de zile.
 *
 * "A scoate" acopera si exportul, si stergerea din telefon — observatie a
 * utilizatorului, si are dreptate: amandoua incaseaza rezultatul triajului.
 * Cine trage 5000 de poze, sterge respinsele si isi curata galeria a primit
 * exact folosul pentru care se plateste, fara sa exporte nimic. Un plafon doar
 * pe export ar fi fost o portita, nu un model.
 */
export const FREE_PHOTOS_PER_MONTH = 150;
/** Cate persoane poate inrola gratuit un utilizator neabonat (a doua+ cere abonament). */
export const FREE_ENROLLED_PERSONS = 1;

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reintreaba Google Play si actualizeaza cache-ul local. De apelat la pornire si
 * dupa o cumparare reusita.
 *
 * Scrie DOAR cand primeste un raspuns: queryPremiumActive() intoarce `false` si
 * la esec de retea (vezi core/billing.ts), iar pe web e mereu `false` — daca am
 * scrie neconditionat, o pornire offline sau o deschidere in browser ar sterge
 * abonamentul cuiva care chiar plateste.
 */
export async function refreshEntitlement(): Promise<boolean> {
  if (!isBillingAvailable()) return isPremium();
  const [active, price] = await Promise.all([queryPremiumActive(), queryPremiumPrice()]);
  try {
    localStorage.setItem(PREMIUM_FLAG_KEY, active ? '1' : '0');
    // Doar cand chiar am primit un pret. Un `null` inseamna "n-am aflat" (fara
    // retea, produs neconfigurat inca), nu "nu se poate cumpara" — deci nu
    // stergem un `1` scris cand Play chiar raspunsese.
    if (price) localStorage.setItem(PURCHASABLE_KEY, '1');
  } catch {
    // stocare indisponibila — ramane starea din memoria sesiunii curente
  }
  return active;
}

/**
 * Exista o cale reala de plata pe acest dispozitiv.
 *
 * De asta atarna TOATE blocarile de plafon, si e singurul lucru care le
 * deosebeste de o inselatorie: un plafon care opreste utilizatorul fara sa-i dea
 * cum sa treaca de el nu e un model freemium, e un perete. Cat timp produsul nu
 * e configurat in Play Console sau build-ul nu e semnat, plafoanele raman pur
 * informative, exact ca inainte — iar cand configurarea e gata, se activeaza
 * singure, fara nicio schimbare de cod.
 */
export function isPurchasable(): boolean {
  try {
    return localStorage.getItem(PURCHASABLE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Plafonul chiar opreste actiunea: nu esti abonat, ai depasit, SI ai de unde cumpara. */
export function isCapEnforced(): boolean {
  return !isPremium() && isPurchasable();
}

/**
 * O functie rezervata abonatilor e blocata acum.
 *
 * Aceeasi regula ca la plafoane, si din acelasi motiv: nu blocam nimic cat timp
 * nu exista o cale reala de plata pe dispozitiv. Diferenta e doar de forma —
 * plafoanele sunt despre CAT, astea sunt despre CE.
 *
 * Ce e blocat, si de ce tocmai astea: predarea catre Lightroom (XMP),
 * plansa de contact, sugestia de combinare a doua cadre, recapul lunar,
 * prezentarea, calatoriile si dosarul privat. Toate vin DUPA ce triajul s-a
 * terminat — sunt despre ce faci cu rezultatul, nu despre a-l obtine.
 *
 * Ce ramane gratuit desi s-ar fi putut bloca, ca decizie explicita: importul si
 * analiza AI (oricate poze), supervizorul galeriei, gruparea, stergerea pozelor
 * respinse, statisticile, si backup-ul profilului antrenat. Ultimul mai ales:
 * sunt deciziile TALE, iar a le tine ostatice ar fi santaj — si contrazice
 * dreptul la portabilitatea datelor.
 */
export function isPremiumFeatureLocked(): boolean {
  return !isPremium() && isPurchasable();
}

export function isPremium(): boolean {
  try {
    return localStorage.getItem(PREMIUM_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function readExportLog(): number[] {
  try {
    const raw = localStorage.getItem(USAGE_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function writeExportLog(entries: number[]): void {
  try {
    localStorage.setItem(USAGE_LOG_KEY, JSON.stringify(entries));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — folosirea continua fara sa fie numarata, degradare sigura
  }
}

/** Cate poze au fost scoase (exportate SAU sterse din telefon) in ultimele 30 de zile — fereastra glisanta, nu "luna calendaristica". */
export function photosUsedInRollingMonth(now = Date.now()): number {
  const cutoff = now - ROLLING_WINDOW_MS;
  return readExportLog().filter(ts => ts > cutoff).length;
}

/**
 * Inregistreaza `count` poze scoase ACUM (exportate sau sterse din telefon).
 * Apelata neconditionat, chiar si pentru abonati — jurnalul ramane util pentru
 * ecranul de folosire, indiferent de abonament.
 */
export function recordPhotosUsed(count: number, now = Date.now()): void {
  if (count <= 0) return;
  const cutoff = now - ROLLING_WINDOW_MS;
  const kept = readExportLog().filter(ts => ts > cutoff);
  for (let i = 0; i < count; i++) kept.push(now);
  writeExportLog(kept);
}

/** Cate poze mai poate scoate gratuit utilizatorul in fereastra curenta (Infinity daca e premium). */
export function remainingFreePhotos(now = Date.now()): number {
  if (isPremium()) return Infinity;
  return Math.max(0, FREE_PHOTOS_PER_MONTH - photosUsedInRollingMonth(now));
}

/** true daca utilizatorul mai poate inrola inca o persoana fara abonament. */
export function canEnrollAnotherPersonFree(currentPersonCount: number): boolean {
  return isPremium() || currentPersonCount < FREE_ENROLLED_PERSONS;
}
