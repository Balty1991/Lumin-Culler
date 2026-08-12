/**
 * state/visualTheme.ts
 * Alegerea identitatii vizuale intregi (Consola — profesional/precis/mono),
 * ca alternativa comutabila, NU inlocuire directa a designului implicit —
 * vezi istoricul "Studio Noir" din accentTheme.ts: o schimbare vizuala mare,
 * aprobata doar pe mockup, testata pe telefon real si respinsa. Acelasi
 * tipar exact ca state/theme.ts si state/accentTheme.ts: logica separata de
 * Zustand, testabila izolat, aplicata prin atribut pe <html> + variabile CSS
 * (vezi :root[data-visual="consola"] in styles.css).
 */
export type VisualTheme = 'default' | 'consola';

const STORAGE_KEY = 'lumin-visual';
const VALID_THEMES: readonly VisualTheme[] = ['default', 'consola'];

export function readStoredVisualTheme(): VisualTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && (VALID_THEMES as readonly string[]).includes(raw) ? (raw as VisualTheme) : 'default';
  } catch {
    return 'default';
  }
}

/** Aplica tema vizuala pe <html> (atribut CSS) + persistare. 'default' = fara atribut (designul curent, neschimbat, niciun selector suplimentar de invins). */
export function applyVisualTheme(theme: VisualTheme): void {
  if (theme === 'default') document.documentElement.removeAttribute('data-visual');
  else document.documentElement.setAttribute('data-visual', theme);

  try { localStorage.setItem(STORAGE_KEY, theme); } catch {
    // stocare indisponibila (mod privat strict etc.) — tema tot se aplica pentru sesiunea curenta
  }
}
