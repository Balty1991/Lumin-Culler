/**
 * state/genre.ts
 * Genul fotografic activ ("Nunta", "Portret", "Peisaj", ...) — ales de utilizator
 * inainte de import, prefixeaza contextKey (ContextEngine.deriveContextKey) astfel
 * incat motorul de invatare sa antreneze modele SEPARATE per gen ("ContextEngine 2.0"
 * din planul de dezvoltare): un fotograf care lucreaza si la nunti si la peisaje nu
 * mai imparte acelasi model de preferinte intre cele doua. Persistat local (ultimul
 * gen folosit), nu in Dexie — e doar comoditatea de a nu-l re-selecta la fiecare sesiune.
 */
const STORAGE_KEY = 'lumin-genre';

/** Presetari comune — utilizatorul poate oricand alege "fara gen" sau scrie unul propriu. */
export const GENRE_PRESETS = ['Nunta', 'Portret', 'Eveniment', 'Peisaj', 'Sport', 'Studio'];

export function readStoredGenre(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredGenre(genre: string): void {
  try {
    if (genre) localStorage.setItem(STORAGE_KEY, genre);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stocare indisponibila (mod privat strict etc.) — genul tot se aplica pentru sesiunea curenta
  }
}
