/**
 * state/gallerySupervisor.ts
 * "Supervizorul galeriei" — cerinta directa a utilizatorului: nu un import
 * masiv al intregii galerii dintr-o data (surprinzator, consuma bateria/
 * timpul telefonului analizand mii de poze deodata, fara control), ci un
 * import GHIDAT pe perioade cronologice — cele mai vechi poze intai, lungime
 * aleasa de utilizator (1/2/3 luni, in functie de cat timp are disponibil) —
 * cu recomandarea explicita a urmatoarei perioade dupa ce cea curenta a fost
 * adusa. Cursorul (coveredUntilMs) tine minte pana unde s-a ajuns deja, ca
 * AI-ul sa "stie ce perioade a recomandat anterior si ce a ramas nesortat"
 * fara sa retina o lista separata per-perioada — o secventa STRICT
 * cronologica (nu paralela pe mai multe perioade deodata), exact cum a fost
 * descrisa cerinta. Selectorul calendaristic (listAllPeriods) permite totusi
 * sa sari INAINTEA cursorului la orice perioada, cu confirmare daca era deja
 * acoperita — vezi isPeriodAlreadyCovered.
 *
 * Functii pure separate de citirea/scrierea din localStorage de mai jos,
 * testabile izolat.
 */
const COVERED_UNTIL_KEY = 'lumin-gallery-supervisor-covered-until';
const PERIOD_MONTHS_KEY = 'lumin-gallery-supervisor-period-months';
const BANNER_DISMISSED_KEY = 'lumin-gallery-supervisor-banner-dismissed-date';
const IMPORTED_FOLDERS_KEY = 'lumin-gallery-supervisor-imported-folders';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Aproximare deliberata (nu luna calendaristica exacta) — consistenta indiferent de luna aleasa, acelasi compromis facut deja la ~2 luni initial. */
const MONTH_MS = 30 * DAY_MS;

/**
 * Variantele oferite explicit ("adauga mai multe intervale... in functie de
 * cat timp disponibil are utilizatorul") — de la o sesiune scurta (2
 * saptamani) pana la una ampla (1 an), nu doar 1-3 luni. 0.5 = 2 saptamani
 * (jumatate de luna, aceeasi aproximare de 30 zile/luna ca restul).
 */
/** "Toata perioada" (cerinta directa) — o singura bucata, de la cea mai veche
    poza pana acum. 1200 de luni (~100 de ani) e sigur mai mult decat intervalul
    oricarei galerii reale, deci listAllPeriods produce exact O perioada, iar
    restul logicii (cursor, "urmeaza", acoperire) merge neschimbata — nu are
    nevoie de nicio ramura speciala. Vezi periodMonthsLabel in
    ui/GallerySupervisorPanel.tsx pentru eticheta. */
export const ALL_PERIOD_MONTHS = 1200;
export const PERIOD_MONTH_OPTIONS = [0.5, 1, 2, 3, 6, 12, ALL_PERIOD_MONTHS] as const;
export type PeriodMonths = typeof PERIOD_MONTH_OPTIONS[number];

/** ~2 luni — valoarea implicita, pastrata si ca fallback de test/compatibilitate. */
export const SUPERVISOR_PERIOD_MS = 2 * MONTH_MS;

export function periodMonthsToMs(months: PeriodMonths): number {
  return months * MONTH_MS;
}

export function readPeriodMonths(): PeriodMonths {
  try {
    const raw = Number(localStorage.getItem(PERIOD_MONTHS_KEY));
    return (PERIOD_MONTH_OPTIONS as readonly number[]).includes(raw) ? (raw as PeriodMonths) : 2;
  } catch {
    return 2;
  }
}

export function writePeriodMonths(months: PeriodMonths): void {
  try { localStorage.setItem(PERIOD_MONTHS_KEY, String(months)); } catch {
    // stocare indisponibila — preferinta ramane activa doar pentru sesiunea curenta
  }
}

export function readCoveredUntil(): number | null {
  try {
    const raw = localStorage.getItem(COVERED_UNTIL_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function writeCoveredUntil(ms: number): void {
  try { localStorage.setItem(COVERED_UNTIL_KEY, String(ms)); } catch {
    // stocare indisponibila — supervizorul poate recomanda aceeasi perioada din nou la urmatoarea vizita
  }
}

function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

/** "Inchide" bannerul de pe Acasa DOAR pentru ziua curenta (nu permanent) — acelasi tipar ca state/memories.ts. Panoul complet ramane accesibil oricand din Meniu. */
export function readSupervisorBannerDismissedDate(): string | null {
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function writeSupervisorBannerDismissedDate(now: Date = new Date()): void {
  try { localStorage.setItem(BANNER_DISMISSED_KEY, dayKey(now)); } catch {
    // stocare indisponibila — bannerul poate reaparea la urmatoarea vizita
  }
}

export function isSupervisorBannerDismissedToday(dismissedDate: string | null, now: Date = new Date()): boolean {
  return dismissedDate === dayKey(now);
}

export interface GalleryPeriod {
  start: number;
  /** Exclusiv — vezi comentariul din MediaLibraryPlugin.kt:photosInRange (interval [start, end)). */
  end: number;
}

/**
 * Urmatoarea perioada de recomandat, sau null daca s-a ajuns deja la ziua
 * curenta (nimic ramas "in urma" de acoperit).
 */
export function computeNextPeriod(opts: {
  earliestMs: number;
  nowMs: number;
  coveredUntilMs: number | null;
  periodMs?: number;
}): GalleryPeriod | null {
  const periodMs = opts.periodMs ?? SUPERVISOR_PERIOD_MS;
  const start = opts.coveredUntilMs !== null ? Math.max(opts.coveredUntilMs, opts.earliestMs) : opts.earliestMs;
  if (start >= opts.nowMs) return null;
  const end = Math.min(start + periodMs, opts.nowMs);
  return { start, end };
}

/**
 * "Tot ce a ramas" (cerinta directa: "inclusiv butonul toata perioada") — de
 * la cursor pana acum, INTR-UN SINGUR PAS, indiferent de lungimea aleasa
 * pentru perioadele individuale. null daca s-a ajuns deja la zi (nimic ramas).
 */
export function computeRemainingPeriod(opts: {
  earliestMs: number;
  nowMs: number;
  coveredUntilMs: number | null;
}): GalleryPeriod | null {
  const start = opts.coveredUntilMs !== null ? Math.max(opts.coveredUntilMs, opts.earliestMs) : opts.earliestMs;
  if (start >= opts.nowMs) return null;
  return { start, end: opts.nowMs };
}

export interface GalleryPeriodEntry extends GalleryPeriod {
  /** true daca perioada e in intregime inaintea cursorului — deja recomandata/adusa anterior. */
  covered: boolean;
}

/**
 * TOATE perioadele consecutive, de la cea mai veche poza pana acum — pentru
 * selectorul calendaristic manual (cerinta directa: "poti face selectorul
 * gen calendaristic"), fiecare marcata daca a fost deja acoperita de cursor.
 * Plafonat implicit la 240 de intrari (20 de ani la perioade de o luna) —
 * plasa de siguranta pentru o data eronata din galerie (EXIF/MediaStore
 * corupt), nu o limita reala pentru o utilizare normala.
 */
const MAX_PERIOD_ENTRIES = 240;

export function listAllPeriods(opts: {
  earliestMs: number;
  nowMs: number;
  coveredUntilMs: number | null;
  periodMs: number;
}): GalleryPeriodEntry[] {
  const { earliestMs, nowMs, periodMs } = opts;
  if (earliestMs >= nowMs || periodMs <= 0) return [];
  const coveredUntilMs = opts.coveredUntilMs ?? earliestMs;
  const periods: GalleryPeriodEntry[] = [];
  let cursor = earliestMs;
  while (cursor < nowMs && periods.length < MAX_PERIOD_ENTRIES) {
    const end = Math.min(cursor + periodMs, nowMs);
    periods.push({ start: cursor, end, covered: end <= coveredUntilMs });
    cursor = end;
  }
  return periods;
}

/**
 * true daca perioada a fost (macar partial) deja acoperita — folosit ca sa
 * ceara confirmare inainte de a re-aduce o perioada deja sortata ("sa intrebe
 * utilizatorii daca selecteaza o perioada deja sortata daca vor sa o faca
 * din nou").
 */
export function isPeriodAlreadyCovered(period: GalleryPeriod, coveredUntilMs: number | null): boolean {
  if (coveredUntilMs === null) return false;
  return period.start < coveredUntilMs;
}

/**
 * Cat din TOATA galeria (de la cea mai veche poza pana acum) a fost deja
 * "acoperita" de supervizor — procent 0-100, idee proprie pentru cardul de
 * pe Acasa (distinct de "% organizata", care masoara doar deciziile luate
 * peste pozele DEJA aduse in aplicatie). null (0%) daca intervalul galeriei
 * inca nu s-a incarcat sau galeria e goala (earliest >= now, nimic de acoperit).
 */
export function computeGalleryCoveragePercent(opts: {
  earliestMs: number;
  nowMs: number;
  coveredUntilMs: number | null;
}): number {
  const span = opts.nowMs - opts.earliestMs;
  if (span <= 0) return 100;
  const covered = opts.coveredUntilMs !== null ? Math.max(0, Math.min(opts.coveredUntilMs, opts.nowMs) - opts.earliestMs) : 0;
  return Math.round((covered / span) * 100);
}

/**
 * Uita tot ce stie supervizorul despre ce a fost deja adus — cursorul
 * cronologic si folderele bifate.
 *
 * Chemata de "Goleste sesiunea" (state/store.ts): cursorul descrie "pana unde
 * am adus deja poze IN biblioteca". Cand biblioteca e golita, afirmatia devine
 * falsa prin definitie. Bug real raportat: dupa golirea sesiunii, supervizorul
 * arata in continuare perioada ca acoperita si un procent de acoperire mostenit,
 * asa ca perioada tocmai stearsa parea deja rezolvata si nu se mai putea relua
 * curat. Aceeasi logica prin care folderele personalizate se sterg odata cu
 * sesiunea, iar persoanele inrolate NU (identitati durabile, nu date de sesiune).
 *
 * Lungimea perioadei ramane: e o preferinta despre CUM vrei sa lucrezi, nu o
 * evidenta a ce s-a adus.
 */
export function resetSupervisorProgress(): void {
  try {
    localStorage.removeItem(COVERED_UNTIL_KEY);
    localStorage.removeItem(IMPORTED_FOLDERS_KEY);
    localStorage.removeItem(BANNER_DISMISSED_KEY);
  } catch {
    // stocare indisponibila — starea din memorie e oricum resetata de apelant
  }
}

export function readImportedFolderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(IMPORTED_FOLDERS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function writeImportedFolderIds(ids: ReadonlySet<string>): void {
  try { localStorage.setItem(IMPORTED_FOLDERS_KEY, JSON.stringify([...ids])); } catch {
    // stocare indisponibila — folderele deja aduse pot fi propuse din nou la urmatoarea vizita
  }
}
