import type { CullingStrictness } from '../core/scoreThresholds';

/**
 * state/cullingStrictness.ts
 * Cat de exigent vrea utilizatorul sa fie motorul, pastrat intre sesiuni.
 *
 * Sta in localStorage, nu in Dexie: e o preferinta de folosire, ca tema sau
 * limba, nu un dato al bibliotecii. Consecinta deliberata — se aplica pe TOATE
 * proiectele si supravietuieste unui "Goleste sesiunea": cine a stabilit o data
 * ca vrea un triaj mai bland n-are de ce sa repete asta la fiecare import nou.
 *
 * Valoarea implicita e 'balanced', identica bit cu bit cu comportamentul de
 * dinainte ca setarea sa existe — vezi applyStrictness din core/scoreThresholds.ts.
 */
const STORAGE_KEY = 'lumin-culling-strictness';

const VALUES: readonly CullingStrictness[] = ['lax', 'balanced', 'strict'];

export function isCullingStrictness(v: unknown): v is CullingStrictness {
  return typeof v === 'string' && (VALUES as readonly string[]).includes(v);
}

export function readCullingStrictness(): CullingStrictness {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Orice altceva (cheie lipsa, valoare de la o versiune viitoare, stocare
    // otravita de un backup editat de om) inseamna implicitul, nu o eroare.
    return isCullingStrictness(raw) ? raw : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function writeCullingStrictness(value: CullingStrictness): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — alegerea tine pentru sesiunea curenta
  }
}
