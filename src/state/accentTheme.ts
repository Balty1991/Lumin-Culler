/**
 * state/accentTheme.ts
 * Alegerea culorii de accent (plan modernizare, cerinta directa: utilizatorul
 * alege el aspectul, in loc sa aleg eu unul singur pentru toata lumea — vezi
 * istoricul "Studio Noir" respins pe telefon real dupa ce fusese aprobat doar
 * pe mockup). Acelasi tipar ca state/theme.ts: logica separata de Zustand,
 * testabila izolat, aplicata prin atribut pe <html> + variabile CSS (vezi
 * :root[data-accent="..."] in styles.css).
 */
/**
 * 'teal' e accentul plat turcoaz respins candva ca DEFAULT pentru toata lumea
 * ("Studio Noir", vezi comentariul --accent-gradient din styles.css) — revine
 * aici doar ca OPTIUNE, alaturi de celelalte, exact ca in mockup-ul 15 din
 * prezentare (a doua pastila, culoare plina). A alege tu un aspect plat nu e
 * acelasi lucru cu a-l primi impus.
 */
export type AccentTheme = 'classic' | 'teal' | 'sunset' | 'holo' | 'legacy';

const STORAGE_KEY = 'lumin-accent';
const VALID_ACCENTS: readonly AccentTheme[] = ['classic', 'teal', 'sunset', 'holo', 'legacy'];

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
