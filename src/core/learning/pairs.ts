/**
 * core/learning/pairs.ts
 * Perechile „asta, nu aia” alese de om (compararea a două cadre din aceeași serie).
 * Sunt cel mai curat semnal de gust: aceeași scenă, aceeași lumină, diferă doar cadrul.
 * Folosite de motorul de preferințe (Bradley–Terry, etapa 3).
 */
export interface Pair { w: string; l: string; t: number }
const KEY = 'cp.pairs.v1';
const MAX = 2000;

export function readPairs(): Pair[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(p => p && typeof p.w === 'string' && typeof p.l === 'string') : [];
  } catch { return []; }
}

export function recordPair(winner: string, loser: string, now = Date.now()): void {
  if (winner === loser) return;
  // O pereche nouă înlocuiește o alegere veche între aceleași două poze.
  const list = readPairs().filter(p => !((p.w === winner && p.l === loser) || (p.w === loser && p.l === winner)));
  list.push({ w: winner, l: loser, t: now });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* fără stocare */ }
}
