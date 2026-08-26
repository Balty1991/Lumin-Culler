import { EMPTY_STYLE, type EditStyleProfile } from '../core/editStyle';

/**
 * state/editStyleStore.ts
 * Unde traieste stilul de editare invatat — vezi core/editStyle.ts pentru CE e.
 *
 * In localStorage, nu in Dexie: sunt douasprezece numere si un contor, citite
 * de fiecare data cand se apasa Auto. O tabela Dexie ar fi insemnat o citire
 * asincrona pe drumul unei actiuni care trebuie sa para instantanee.
 *
 * `enabled` e separat de profil cu buna stiinta: cine opreste aplicarea nu-si
 * pierde stilul strans, si nici nu se opreste din a mai invata. Il poate porni
 * inapoi si il gaseste acolo.
 */
const PROFILE_KEY = 'lumin-edit-style';
const ENABLED_KEY = 'lumin-edit-style-enabled';

export function readEditStyle(): EditStyleProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return EMPTY_STYLE;
    const parsed = JSON.parse(raw) as Partial<EditStyleProfile>;
    if (!parsed || typeof parsed.samples !== 'number' || typeof parsed.deltas !== 'object' || !parsed.deltas) {
      return EMPTY_STYLE;
    }
    return { deltas: parsed.deltas, samples: parsed.samples, updatedAt: parsed.updatedAt ?? 0 };
  } catch {
    return EMPTY_STYLE;
  }
}

export function writeEditStyle(profile: EditStyleProfile): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {
    // stocare indisponibila — stilul traieste cat sesiunea si atat
  }
}

export function forgetEditStyle(): void {
  try { localStorage.removeItem(PROFILE_KEY); } catch { /* nimic de facut */ }
}

/** Pornit din start, ca notificarile: o functie care se invata singura n-are rost daca trebuie intai gasita. */
export function readEditStyleEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== '0'; } catch { return true; }
}

export function writeEditStyleEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* nimic de facut */ }
}
