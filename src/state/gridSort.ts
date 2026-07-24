/**
 * state/gridSort.ts
 * Sortare configurabila a grilei (plan 3.2.1) — implicit dupa data capturii
 * (cea mai veche primul, ca pana acum), dar utilizatorul poate alege orice alt
 * criteriu util la culling: scor AI, claritate, rating, nume fisier. Persistata
 * local, la fel ca densitatea grilei (gridDensity.ts).
 */
export type SortKey = 'date' | 'score' | 'sharpness' | 'rating' | 'filename';
export type SortDirection = 'asc' | 'desc';

export interface GridSort {
  key: SortKey;
  dir: SortDirection;
}

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  date: 'Data capturii',
  score: 'Scor AI',
  sharpness: 'Claritate',
  rating: 'Rating',
  filename: 'Nume fisier'
};

const STORAGE_KEY = 'lumin-grid-sort';
const DEFAULT_SORT: GridSort = { key: 'date', dir: 'asc' };

function isSortKey(v: unknown): v is SortKey {
  return v === 'date' || v === 'score' || v === 'sharpness' || v === 'rating' || v === 'filename';
}

function isSortDirection(v: unknown): v is SortDirection {
  return v === 'asc' || v === 'desc';
}

export function readGridSort(): GridSort {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw);
    if (isSortKey(parsed?.key) && isSortDirection(parsed?.dir)) return { key: parsed.key, dir: parsed.dir };
    return DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

export function writeGridSort(sort: GridSort): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}

/** Forma minima ceruta pentru sortare — orice PhotoView se potriveste structural, fara import direct din store.ts (ar crea o dependinta circulara). */
export interface SortablePhoto {
  capturedAt?: number;
  aiScore: number;
  sharpness: number;
  rating: number;
  fileName: string;
}

/** Comparator ascendent brut (fara directie) — store.ts inverseaza rezultatul cand dir === 'desc'. */
export function compareBy(key: SortKey, a: SortablePhoto, b: SortablePhoto): number {
  switch (key) {
    case 'date': return (a.capturedAt ?? 0) - (b.capturedAt ?? 0);
    case 'score': return a.aiScore - b.aiScore;
    case 'sharpness': return a.sharpness - b.sharpness;
    case 'rating': return a.rating - b.rating;
    case 'filename': return a.fileName.localeCompare(b.fileName);
  }
}
