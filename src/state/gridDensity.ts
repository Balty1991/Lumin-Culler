/**
 * state/gridDensity.ts
 * Dimensiunea miniaturilor in grila (VirtualPhotoGrid + grila simpla din App.tsx) —
 * profesionistii care lucreaza pe biblioteci mari prefera miniaturi mici (mai multe
 * poze vizibile deodata, comparatie rapida de serii), pe cand cei care evalueaza
 * claritatea/expresiile faciale direct din grila prefera miniaturi mari. Persistat
 * local, aplicat imediat (fara reload) — spre deosebire de modul economic, nu
 * afecteaza deloc pool-ul de workeri, doar randarea.
 */
export type GridDensity = 'compact' | 'comfortable' | 'large';

const STORAGE_KEY = 'lumin-grid-density';

/** latimea minima a unei carti, in pixeli — 'wide' = ecrane normale, 'narrow' = sub NARROW_BREAKPOINT (VirtualPhotoGrid.tsx). */
export const CARD_MIN_WIDTH: Record<GridDensity, { wide: number; narrow: number }> = {
  compact: { wide: 126, narrow: 96 },
  // valorile implicite ("comfortable") coincid cu cele deja folosite in .grid din styles.css
  comfortable: { wide: 176, narrow: 126 },
  large: { wide: 240, narrow: 168 }
};

const ORDER: GridDensity[] = ['compact', 'comfortable', 'large'];

/** Urmatoarea densitate in ciclu (Compact -> Confortabil -> Mare -> Compact...) — pentru butonul de comutare din meniu. */
export function nextGridDensity(current: GridDensity): GridDensity {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

function isGridDensity(v: string | null): v is GridDensity {
  return v === 'compact' || v === 'comfortable' || v === 'large';
}

/**
 * Implicit COMPACT, nu confortabil: cerinta directa a utilizatorului dupa ce a
 * comparat cele doua pe telefonul lui — la 126px latime intra trei coloane
 * intregi pe un ecran de telefon, adica noua poze deodata in loc de sase, si
 * exact asta e treaba unei grile de triaj (sa vezi seria, nu o poza). Cine
 * prefera altfel schimba din meniu, o data, si alegerea ramane salvata.
 */
export function readGridDensity(): GridDensity {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isGridDensity(v) ? v : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeGridDensity(density: GridDensity): void {
  try {
    localStorage.setItem(STORAGE_KEY, density);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — setarea tot se aplica pentru sesiunea curenta
  }
}
