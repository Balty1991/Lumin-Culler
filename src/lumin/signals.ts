import { recordPersonDecision } from '../core/personTaste';
import { useStore, type PhotoView } from '../state/store';

/**
 * lumin/signals.ts
 * Lumi învață și din ce faci fără să sortezi:
 * - o poză TRIMISĂ cuiva e cel mai puternic „îmi place” — dacă era la „Nu azi”
 *   sau nedecisă, trece la Păstrate (și e o lecție, ca orice Păstrez);
 * - o poză deschisă des (a treia oară) spune ceva despre oamenii din ea.
 */
const OPENS_KEY = 'lumin-opens';
const OPENS_SIGNAL = 3;

export async function learnFromShare(photos: readonly PhotoView[]): Promise<number> {
  const { setStatus } = useStore.getState();
  let moved = 0;
  for (const p of photos) {
    recordPersonDecision(p.personNames, true);
    if (p.status !== 'selected') { await setStatus(p.id, 'selected'); moved++; }
  }
  return moved;
}

export function learnFromOpen(p: PhotoView): void {
  try {
    const opens = JSON.parse(localStorage.getItem(OPENS_KEY) ?? '{}') as Record<string, number>;
    const n = (opens[p.id] ?? 0) + 1;
    opens[p.id] = n;
    // Doar ultimele ~500, ca să nu crească la nesfârșit.
    const keys = Object.keys(opens);
    if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete opens[k];
    localStorage.setItem(OPENS_KEY, JSON.stringify(opens));
    if (n === OPENS_SIGNAL) recordPersonDecision(p.personNames, true);
  } catch { /* fără stocare: fără semnal */ }
}
