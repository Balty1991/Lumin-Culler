/**
 * state/history.ts
 * Stiva de undo pentru deciziile manuale (Selecteaza/Respinge) — functii pure,
 * fara Zustand/Dexie/React, ca sa fie testabile izolat (vezi history.test.ts).
 */
import type { PhotoRecord } from '../core/db';

export interface HistoryEvent {
  photoId: string;
  previousStatus: PhotoRecord['status'];
  newStatus: PhotoRecord['status'];
  ts: number;
}

export const MAX_HISTORY = 10;

/** Adauga un eveniment, pastrand doar ultimele MAX_HISTORY (FIFO peste limita). */
export function pushHistory(stack: HistoryEvent[], event: HistoryEvent): HistoryEvent[] {
  const next = [...stack, event];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** Scoate ultimul eveniment (LIFO) — { event: null, rest: stack } daca e goala. */
export function popHistory(stack: HistoryEvent[]): { event: HistoryEvent | null; rest: HistoryEvent[] } {
  if (!stack.length) return { event: null, rest: stack };
  return { event: stack[stack.length - 1], rest: stack.slice(0, -1) };
}
