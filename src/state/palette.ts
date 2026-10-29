import { phoneColors, setSystemBars, type PhoneColors } from '../core/device';
import type { ResolvedTheme } from './theme';

/**
 * state/palette.ts
 * Culorile aplicației, peste tema deschisă/întunecată (state/theme.ts):
 *  - „cherry” (implicit): culorile iconiței Cherrypic — vezi src/palettes.css;
 *  - „aurora”: vechiul cyan→violet;
 *  - „phone”: culorile fundalului ales pe telefon (Material You, Android 12+).
 *
 * public/theme-init.js aplică aceeași cheie înainte de prima randare (fără
 * clipire). Pentru „phone” ține și ultimele culori citite, ca să le poată pune
 * înainte ca plugin-ul nativ să răspundă.
 */
export type Palette = 'cherry' | 'aurora' | 'phone';
export const PALETTES: readonly Palette[] = ['cherry', 'aurora', 'phone'];

const KEY = 'lumin-palette';
const PHONE_KEY = 'lumin-phone-colors';

/** Variabilele puse direct pe <html> pentru „phone” — șterse la schimbarea paletei. */
const PHONE_VARS = ['--accent', '--accent-2', '--accent-rgb', '--accent-2-rgb', '--accent-text', '--accent-2-text', '--accent-gradient',
  '--brand-grad', '--orb-hi', '--orb-1', '--orb-2', '--orb-3', '--atelier-teal', '--atelier-violet', '--grid-line'];

export function readStoredPalette(): Palette {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && (PALETTES as readonly string[]).includes(raw) ? (raw as Palette) : 'cherry';
  } catch { return 'cherry'; }
}

function rgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Tonurile Material You potrivite temei: deschise pe noapte, închise pe zi. */
export function phoneVars(c: PhoneColors, theme: ResolvedTheme): Record<string, string> {
  const dark = theme === 'dark';
  const a = dark ? c.accent1['200'] : c.accent1['600'];
  const b = dark ? c.accent3['200'] : c.accent3['600'];
  const mid = dark ? c.accent2['200'] : c.accent2['500'];
  return {
    '--accent': a,
    '--accent-2': b,
    '--accent-rgb': rgb(a),
    '--accent-2-rgb': rgb(b),
    '--accent-text': dark ? c.accent1['100'] : c.accent1['700'],
    '--accent-2-text': dark ? c.accent3['100'] : c.accent3['700'],
    '--accent-gradient': `linear-gradient(90deg, ${a} 0%, ${b} 100%)`,
    '--brand-grad': `linear-gradient(120deg, ${a} 0%, ${mid} 50%, ${b} 100%)`,
    '--orb-hi': c.accent1['100'],
    '--orb-1': a,
    '--orb-2': b,
    '--orb-3': c.accent1['500'],
    '--atelier-teal': a,
    '--atelier-violet': b,
    '--grid-line': `rgb(${rgb(a)} / 0.025)`
  };
}

function resolvedTheme(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function paint(colors: PhoneColors | null, palette: Palette): void {
  const root = document.documentElement;
  for (const v of PHONE_VARS) root.style.removeProperty(v);
  if (palette === 'phone' && colors) {
    // Baza (fundal, suprafețe) rămâne cea Cherrypic; doar accentele vin din telefon.
    root.setAttribute('data-palette', 'cherry');
    for (const [k, v] of Object.entries(phoneVars(colors, resolvedTheme()))) root.style.setProperty(k, v);
  } else {
    root.setAttribute('data-palette', palette === 'phone' ? 'cherry' : palette);
  }
  const light = resolvedTheme() === 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  const cherryLike = root.getAttribute('data-palette') === 'cherry';
  if (meta) meta.setAttribute('content', light ? (cherryLike ? '#fbf6f8' : '#f5f5f7') : (cherryLike ? '#0b0816' : '#0a0b0d'));
  setSystemBars(light);
}

function cachedPhoneColors(): PhoneColors | null {
  try { const raw = localStorage.getItem(PHONE_KEY); return raw ? (JSON.parse(raw) as PhoneColors) : null; } catch { return null; }
}

/** Aplică paleta (și o ține minte). Se cheamă și după fiecare schimbare de temă. */
export function applyPalette(palette: Palette = readStoredPalette()): void {
  try { localStorage.setItem(KEY, palette); } catch { /* fără stocare */ }
  paint(palette === 'phone' ? cachedPhoneColors() : null, palette);
  if (palette !== 'phone') return;
  void phoneColors().then(colors => {
    if (!colors || readStoredPalette() !== 'phone') return;
    try { localStorage.setItem(PHONE_KEY, JSON.stringify(colors)); } catch { /* fără stocare */ }
    paint(colors, 'phone');
  });
}

/** Culorile telefonului există doar pe Android 12+. */
export async function phonePaletteAvailable(): Promise<boolean> {
  return (await phoneColors()) !== null;
}
