/**
 * lumin/myLook.ts
 * „Stilul tău”: ce stil și la ce intensitate salvezi de obicei în editor. După
 * trei poze salvate, editorul pornește direct pe el, iar „Mai frumoase” îl
 * aplică pe o zi întreagă. Media e mobilă: ultimele alegeri contează mai mult,
 * deci stilul se schimbă odată cu tine. Doar pe telefon (localStorage).
 */
export interface LookMemory { saves: number; styles: Record<string, { n: number; amount: number }> }
export interface MyLook { style: string; amount: number; saves: number }

const KEY = 'cherrypic.myLook';
export const LOOK_MIN_SAVES = 3;
const DECAY = 0.85;

export function foldLook(mem: LookMemory, style: string, amount: number): LookMemory {
  const styles: LookMemory['styles'] = {};
  for (const [k, v] of Object.entries(mem.styles)) styles[k] = { n: v.n * DECAY, amount: v.amount };
  const prev = styles[style];
  styles[style] = prev
    ? { n: prev.n + 1, amount: prev.amount * 0.6 + amount * 0.4 }
    : { n: 1, amount };
  return { saves: mem.saves + 1, styles };
}

/** Stilul ales cel mai des (cu greutate pe ultimele salvări); `null` până la trei salvări. */
export function pickLook(mem: LookMemory): MyLook | null {
  if (mem.saves < LOOK_MIN_SAVES) return null;
  const top = Object.entries(mem.styles).sort((a, b) => b[1].n - a[1].n)[0];
  if (!top) return null;
  return { style: top[0], amount: Math.round(Math.max(0.2, Math.min(1.5, top[1].amount)) * 20) / 20, saves: mem.saves };
}

function read(): LookMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LookMemory | null;
    if (raw && typeof raw.saves === 'number' && raw.styles && typeof raw.styles === 'object') return raw;
  } catch { /* fără stocare */ }
  return { saves: 0, styles: {} };
}

export function learnLook(style: string, amount: number): void {
  try { localStorage.setItem(KEY, JSON.stringify(foldLook(read(), style, amount))); } catch { /* fără stocare */ }
}
export function readMyLook(): MyLook | null { return pickLook(read()); }
