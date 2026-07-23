/**
 * state/theme.ts
 * Tema deschisa/inchisa — logica separata de Zustand ca sa fie testabila izolat.
 * Implicit intunecat (identitatea vizuala a aplicatiei); tema deschisa e o
 * optiune explicita, persistata local. Vezi si scriptul inline din index.html,
 * care aplica aceeasi cheie de localStorage INAINTE de randare, ca sa nu
 * clipeasca tema gresita la incarcare (FOUC).
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'lumin-theme';

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Aplica tema pe <html> (atribut CSS) + culoarea barei de sistem (Android) + persistare. */
export function applyTheme(theme: Theme): void {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f4f6' : '#08090c');

  try { localStorage.setItem(STORAGE_KEY, theme); } catch {
    // stocare indisponibila (mod privat strict etc.) — tema tot se aplica pentru sesiunea curenta
  }
}
