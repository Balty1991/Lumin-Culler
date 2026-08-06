/**
 * state/savedFilters.ts
 * Filtre salvate (cerinta directa a utilizatorului: sa numeasca o combinatie de
 * filtre si s-o reaplice dintr-un click, fara sa retina/reseteze fiecare filtru
 * manual). Persistate local (localStorage), la fel ca genul foto/sortarea grilei
 * — sunt o PREFERINTA a utilizatorului, reutilizabila peste sesiuni si biblioteci
 * diferite, nu date legate de o anumita sesiune de import (spre deosebire de
 * foldere personalizate, golite deliberat la "Goleste sesiunea").
 *
 * Capteaza DOAR criteriile intrinsec reutilizabile ale unei poze (persoana,
 * eticheta culoare, eticheta scena, aparat foto, proiect, text cautat, rating
 * minim) — NU si dateFrom/dateTo/collectionFilter: un interval de date sau un
 * folder personalizat sunt legate strict de sesiunea/biblioteca CURENTA, nu au
 * sens ca preset denumit reutilizat peste luni/sedinte foto viitoare complet
 * nelegate (ar produce mereu o grila goala).
 */
import type { ColorLabel } from '../core/db';

export interface SavedFilterPreset {
  id: string;
  name: string;
  createdAt: number;
  personFilter: string | null;
  colorLabelFilter: ColorLabel | null;
  sceneTagFilter: string | null;
  cameraFilter: string | null;
  projectFilter: string | null;
  searchText: string;
  minRating: number;
}

const STORAGE_KEY = 'lumin-saved-filters';
const VALID_COLOR_LABELS: ColorLabel[] = ['none', 'red', 'yellow', 'green', 'blue', 'purple'];

function isColorLabelOrNull(v: unknown): v is ColorLabel | null {
  return v === null || (typeof v === 'string' && (VALID_COLOR_LABELS as string[]).includes(v));
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

/** Valideaza structural fiecare intrare — o valoare corupta/editata manual in localStorage e sarita, nu arunca. */
function isValidPreset(v: unknown): v is SavedFilterPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.createdAt === 'number' &&
    isStringOrNull(p.personFilter) && isColorLabelOrNull(p.colorLabelFilter) && isStringOrNull(p.sceneTagFilter) &&
    isStringOrNull(p.cameraFilter) && isStringOrNull(p.projectFilter) &&
    typeof p.searchText === 'string' && typeof p.minRating === 'number';
}

export function readSavedFilters(): SavedFilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPreset);
  } catch {
    return [];
  }
}

export function writeSavedFilters(presets: SavedFilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — presetul tot se aplica pentru sesiunea curenta
  }
}
