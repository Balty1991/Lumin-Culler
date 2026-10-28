/**
 * core/sortMode.ts
 * Pentru ce folosești pozele schimbă ce înseamnă „cea mai bună”:
 * - zilnic: echilibrul obișnuit;
 * - părinte: momentele cu oameni păstrează o poză în plus, fețele au prioritate;
 * - vânzător (Vinted/OLX): din fiecare moment o singură poză, cea mai clară
 *   (produsul trebuie să se vadă bine), iar obiectele nu sunt puse deoparte;
 * - creator: o singură poză pe moment, cea mai bună ca imagine.
 */
export type SortMode = 'everyday' | 'parent' | 'seller' | 'creator';
export const SORT_MODES: SortMode[] = ['everyday', 'parent', 'seller', 'creator'];

const KEY = 'lumin-sort-mode';

export function readSortMode(): SortMode {
  try {
    const v = localStorage.getItem(KEY);
    return (SORT_MODES as string[]).includes(v ?? '') ? (v as SortMode) : 'everyday';
  } catch {
    return 'everyday';
  }
}

export function writeSortMode(mode: SortMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* fără stocare */ }
}
