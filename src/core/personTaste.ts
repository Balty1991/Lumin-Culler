/**
 * core/personTaste.ts
 * Gust pe persoană: la cine ții. Fiecare „Păstrez” / „Nu azi” pe o poză cu
 * cineva numit se numără pentru omul acela. Cine e păstrat aproape mereu
 * (copilul, partenerul) primește prioritate: în momentele cu el, AI-ul ține
 * o poză în plus și îl pune primul — chiar dacă poza nu e perfectă.
 */
const KEY = 'lumin-person-taste';
/** Sub atâtea decizii pe o persoană nu tragem concluzii. */
export const MIN_PERSON_DECISIONS = 4;
const FAVORITE_RATE = 0.6;

export type PersonTaste = Record<string, { kept: number; rejected: number }>;

export function readPersonTaste(): PersonTaste {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

export function recordPersonDecision(names: readonly string[], kept: boolean): void {
  if (!names.length) return;
  const all = readPersonTaste();
  for (const n of names) {
    const row = all[n] ?? { kept: 0, rejected: 0 };
    if (kept) row.kept++; else row.rejected++;
    all[n] = row;
  }
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

/** Oamenii păstrați aproape mereu, cu rata lor, cei mai iubiți primii. */
export function favoritePeople(taste: PersonTaste = readPersonTaste()): { name: string; rate: number; total: number }[] {
  return Object.entries(taste)
    .map(([name, c]) => ({ name, total: c.kept + c.rejected, rate: (c.kept + 1) / (c.kept + c.rejected + 2) }))
    .filter(x => x.total >= MIN_PERSON_DECISIONS && x.rate >= FAVORITE_RATE)
    .sort((a, b) => b.rate - a.rate);
}
