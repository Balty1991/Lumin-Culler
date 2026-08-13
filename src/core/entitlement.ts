/**
 * core/entitlement.ts
 * Fundatia LOCALA a modelului freemium decis pentru monetizare: folosirea de
 * baza (import, scor AI, sortare, export normal) ramane gratuita la nesfarsit;
 * recunoasterea a mai mult de o persoana si exportul de poze peste un plafon
 * lunar generos sunt gandite ca sa ceara abonament.
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

import { isBillingAvailable, queryPremiumActive } from './billing';

const PREMIUM_FLAG_KEY = 'lumin-premium';
const EXPORT_LOG_KEY = 'lumin-export-log';

/** Cate poze poate exporta gratuit un utilizator neabonat, intr-o fereastra glisanta de 30 de zile. */
export const FREE_EXPORT_PHOTOS_PER_MONTH = 150;
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
  const active = await queryPremiumActive();
  try {
    localStorage.setItem(PREMIUM_FLAG_KEY, active ? '1' : '0');
  } catch {
    // stocare indisponibila — ramane starea din memoria sesiunii curente
  }
  return active;
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
    const raw = localStorage.getItem(EXPORT_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function writeExportLog(entries: number[]): void {
  try {
    localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify(entries));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — folosirea continua fara sa fie numarata, degradare sigura
  }
}

/** Cate poze au fost exportate in ultimele 30 de zile (fereastra glisanta, nu "luna calendaristica"). */
export function exportsInRollingMonth(now = Date.now()): number {
  const cutoff = now - ROLLING_WINDOW_MS;
  return readExportLog().filter(ts => ts > cutoff).length;
}

/**
 * Inregistreaza `count` poze exportate ACUM. Apelata neconditionat (chiar si
 * pentru utilizatori premium) — jurnalul ramane util pentru un eventual ecran
 * "ai exportat X poze luna asta", indiferent de abonament.
 */
export function recordExport(count: number, now = Date.now()): void {
  if (count <= 0) return;
  const cutoff = now - ROLLING_WINDOW_MS;
  const kept = readExportLog().filter(ts => ts > cutoff);
  for (let i = 0; i < count; i++) kept.push(now);
  writeExportLog(kept);
}

/** Cate poze mai poate exporta gratuit utilizatorul in fereastra curenta (Infinity daca e premium). */
export function remainingFreeExports(now = Date.now()): number {
  if (isPremium()) return Infinity;
  return Math.max(0, FREE_EXPORT_PHOTOS_PER_MONTH - exportsInRollingMonth(now));
}

/** true daca utilizatorul mai poate inrola inca o persoana fara abonament. */
export function canEnrollAnotherPersonFree(currentPersonCount: number): boolean {
  return isPremium() || currentPersonCount < FREE_ENROLLED_PERSONS;
}
