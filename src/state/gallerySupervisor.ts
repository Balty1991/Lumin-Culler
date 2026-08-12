/**
 * state/gallerySupervisor.ts
 * "Supervizorul galeriei" — cerinta directa a utilizatorului: nu un import
 * masiv al intregii galerii dintr-o data (surprinzator, consuma bateria/
 * timpul telefonului analizand mii de poze deodata, fara control), ci un
 * import GHIDAT pe perioade cronologice — cele mai vechi poze intai, ~2 luni
 * pe rand — cu recomandarea explicita a urmatoarei perioade dupa ce cea
 * curenta a fost adusa. Cursorul (coveredUntilMs) tine minte pana unde s-a
 * ajuns deja, ca AI-ul sa "stie ce perioade a recomandat anterior si ce a
 * ramas nesortat" fara sa retina o lista separata per-perioada — o secventa
 * STRICT cronologica (nu paralela pe mai multe perioade deodata), exact cum a
 * fost descrisa cerinta.
 *
 * Functii pure (computeNextPeriod) separate de citirea/scrierea din
 * localStorage de mai jos, testabile izolat.
 */
const COVERED_UNTIL_KEY = 'lumin-gallery-supervisor-covered-until';

/** ~2 luni — perioada implicita ceruta explicit ("Analizam la 2 luni"). */
export const SUPERVISOR_PERIOD_MS = 60 * 24 * 60 * 60 * 1000;

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
