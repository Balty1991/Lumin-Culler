/**
 * state/theme.ts
 * Tema deschisa/inchisa/automata — logica separata de Zustand ca sa fie testabila
 * izolat. Implicit intunecat (identitatea vizuala a aplicatiei); tema deschisa e o
 * optiune explicita, persistata local. Vezi si scriptul inline din index.html,
 * care aplica aceeasi cheie de localStorage INAINTE de randare, ca sa nu
 * clipeasca tema gresita la incarcare (FOUC).
 */
export type Theme = 'dark' | 'light' | 'auto';
/** Ce se aplica de fapt pe DOM — 'auto' nu e o valoare vizuala, doar preferinta stocata. */
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'lumin-theme';
const VALID_THEMES: readonly Theme[] = ['dark', 'light', 'auto'];

export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && (VALID_THEMES as readonly string[]).includes(raw) ? (raw as Theme) : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * "Automat, dupa ora" (plan modernizare) — interval orar fix, NU rasarit/apus real
 * (ar cere permisiune de geolocalizare, disproportionat doar pentru o comutare de
 * tema). 7:00-19:59 luminos, restul intunecat — acopera orele tipice de zi indiferent
 * de anotimp/latitudine, fara nicio permisiune noua.
 */
const AUTO_LIGHT_START_HOUR = 7;
const AUTO_LIGHT_END_HOUR = 20;

/** Functie pura — rezolva preferinta stocata (poate fi 'auto') la tema chiar aplicata. */
export function resolveTheme(theme: Theme, now: Date = new Date()): ResolvedTheme {
  if (theme !== 'auto') return theme;
  const hour = now.getHours();
  return hour >= AUTO_LIGHT_START_HOUR && hour < AUTO_LIGHT_END_HOUR ? 'light' : 'dark';
}

/** Aplica tema pe <html> (atribut CSS) + culoarea barei de sistem (Android) + persistare.
    Persista PREFERINTA bruta (poate fi 'auto'), dar aplica pe DOM tema REZOLVATA. */
export function applyTheme(theme: Theme, now: Date = new Date()): void {
  const resolved = resolveTheme(theme, now);
  if (resolved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f5f5f7' : '#0a0b0d');

  try { localStorage.setItem(STORAGE_KEY, theme); } catch {
    // stocare indisponibila (mod privat strict etc.) — tema tot se aplica pentru sesiunea curenta
  }
}
