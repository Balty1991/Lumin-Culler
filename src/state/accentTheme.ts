/**
 * state/accentTheme.ts
 * Alegerea culorii de accent (plan modernizare, cerinta directa: utilizatorul
 * alege el aspectul, in loc sa aleg eu unul singur pentru toata lumea — vezi
 * istoricul "Studio Noir" respins pe telefon real dupa ce fusese aprobat doar
 * pe mockup). Acelasi tipar ca state/theme.ts: logica separata de Zustand,
 * testabila izolat, aplicata prin atribut pe <html> + variabile CSS (vezi
 * :root[data-accent="..."] in styles.css).
 */
export type AccentTheme = 'classic' | 'sunset' | 'holo';

const STORAGE_KEY = 'lumin-accent';
const VALID_ACCENTS: readonly AccentTheme[] = ['classic', 'sunset', 'holo'];

export function readStoredAccent(): AccentTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && (VALID_ACCENTS as readonly string[]).includes(raw) ? (raw as AccentTheme) : 'classic';
  } catch {
    return 'classic';
  }
}

/** Aplica accentul pe <html> (atribut CSS) + persistare. 'classic' = fara atribut (valoarea implicita din :root, niciun selector suplimentar de specificitate mai mare de invins). */
export function applyAccent(accent: AccentTheme): void {
  if (accent === 'classic') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', accent);

  try { localStorage.setItem(STORAGE_KEY, accent); } catch {
    // stocare indisponibila (mod privat strict etc.) — accentul tot se aplica pentru sesiunea curenta
  }
}
