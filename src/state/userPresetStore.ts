import { sortPresets, type UserPreset } from '../core/userPresets';

/**
 * state/userPresetStore.ts
 * Unde traiesc presetarile salvate de utilizator — vezi core/userPresets.ts.
 *
 * In localStorage, nu in Dexie, din acelasi motiv ca stilul invatat: sunt cel
 * mult douasprezece obiecte mici, citite de fiecare data cand se deschide
 * editorul. O tabela Dexie ar fi insemnat o citire asincrona exact pe drumul
 * randului de presetari, care trebuie sa fie acolo cand se deschide panoul, nu
 * un cadru mai tarziu.
 *
 * Citirea e apararea, nu scrierea: continutul din localStorage poate fi vechi,
 * scris de o versiune anterioara, sau pur si simplu stricat de mana. Orice
 * intrare care nu arata a presetare e ignorata, in loc sa arunce si sa lase
 * omul fara editor.
 */
const STORAGE_KEY = 'lumin-user-presets';

function esteValida(x: unknown): x is UserPreset {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<UserPreset>;
  return typeof p.id === 'string' && p.id.length > 0
    && typeof p.name === 'string' && p.name.length > 0
    && typeof p.createdAt === 'number'
    && !!p.style && typeof p.style === 'object';
}

export function readUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortPresets(parsed.filter(esteValida));
  } catch {
    return [];
  }
}

export function writeUserPresets(presets: readonly UserPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Stocare plina sau blocata. Presetarile sunt o inlesnire, nu munca
    // utilizatorului: se pierd, editarea de pe ecran nu.
  }
}
