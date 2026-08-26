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

/**
 * Presetarile oferite. Utilizatorul poate oricand alege "fara gen".
 *
 * Lista era de sase si incepea cu "Nunta" — adica presupunea un fotograf de
 * evenimente. Utilizatorul a semnalat exact ce lipsea: pozele de familie
 * ocazionale si cele facute la munca. Cele mai obisnuite feluri de poze de pe
 * un telefon nu erau in lista deloc, deci intrebarea suna a chestionar pentru
 * altcineva.
 *
 * Ordinea nu e alfabetica si nici intamplatoare: de la ce fotografiaza toata
 * lumea catre ce fotografiaza cine e platit s-o faca.
 */
export const GENRE_PRESETS = [
  'Familie', 'Copii', 'Nunta', 'Botez', 'Petrecere', 'Eveniment',
  'Vacanta', 'Peisaj', 'Animale', 'Portret', 'Sport', 'Munca', 'Produs', 'Studio'
];

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

/**
 * Genurile pe care omul a spus ca le fotografiaza — lista lui scurta, nu genul
 * activ acum.
 *
 * De ce doua lucruri si nu unul: `genre` (mai sus) prefixeaza contextKey, deci
 * hotaraste PE CARE model se invata acum. Un singur import are un singur fel de
 * poze, deci acolo n-are ce cauta o lista. Dar intrebarea pusa pe Acasa e "ce
 * fel de poze triezi de obicei?", iar la aia raspunsul sincer al majoritatii e
 * "mai multe" — familie, si la munca, si cate un eveniment.
 *
 * Deci: lista se retine ca sa fie la indemana, iar genul activ ramane unul
 * singur si se comuta dintr-o atingere. Daca s-ar amesteca toate intr-un singur
 * model, s-ar pierde exact lucrul pentru care exista genul.
 */
const SHORTLIST_KEY = 'lumin-genre-shortlist';

export function readGenreShortlist(): string[] {
  try {
    const raw = localStorage.getItem(SHORTLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export function writeGenreShortlist(genres: string[]): void {
  try {
    if (genres.length) localStorage.setItem(SHORTLIST_KEY, JSON.stringify(genres));
    else localStorage.removeItem(SHORTLIST_KEY);
  } catch {
    // stocare indisponibila — lista traieste cat sesiunea, ca si genul activ
  }
}
