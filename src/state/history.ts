/**
 * state/history.ts
 * Stiva de undo pentru deciziile manuale (Selecteaza/Respinge) — functii pure,
 * fara Zustand/Dexie/React, ca sa fie testabile izolat (vezi history.test.ts).
 */
import type { ColorLabel, PhotoRecord } from '../core/db';

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

/**
 * Undo pentru OPERATII IN MASA (Auto-Cull, Respinge sub prag, Rezolva toate
 * seriile, actiuni pe selectia multipla) — o singura intrare per lot intreg,
 * nu una per poza afectata (ar inunda instant stiva de 10 a lui HistoryEvent
 * la un lot de zeci de poze). Doar in memorie (nu persistat in Dexie, spre
 * deosebire de HistoryRecord) — un lot facut intr-o sesiune anterioara oricum
 * nu mai are sens sa fie anulat separat de restul deciziilor acelei sesiuni.
 */
export interface BatchHistoryEvent {
  id: string;
  label: string;
  changes: { photoId: string; previousStatus: PhotoRecord['status'] }[];
  ts: number;
}

export const MAX_BATCH_HISTORY = 5;

/** Generica peste tipul evenimentului (BatchHistoryEvent SAU FieldBatchHistoryEvent mai jos) — ambele au doar nevoie de `ts` pentru sortare/capare. */
export function pushBatchHistory<T extends { ts: number }>(stack: T[], event: T): T[] {
  const next = [...stack, event];
  return next.length > MAX_BATCH_HISTORY ? next.slice(next.length - MAX_BATCH_HISTORY) : next;
}

export function popBatchHistory<T extends { ts: number }>(stack: T[]): { event: T | null; rest: T[] } {
  if (!stack.length) return { event: null, rest: stack };
  return { event: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/**
 * Undo pentru editari in masa pe CAMPURI ALTELE decat status (rating,
 * eticheta de culoare, descriere/cuvinte cheie override) — bug real gasit de
 * auditul QA: bulkSetRatingForSelection si surorile ei (store.ts) suprascriau
 * valorile mai multor poze deodata FARA nicio urma in vreo stiva de undo,
 * deci Ctrl+Z fie raporta "nimic de anulat", fie (mai rau) anula o alta
 * actiune neconexa aflata deja pe stiva `batchHistory`, lasand editarea in
 * masa reala imposibil de revenit. Stiva SEPARATA (nu extindem
 * BatchHistoryEvent) ca sa nu atingem cele ~7 locuri deja existente care
 * construiesc evenimente de status prin makeBatchEvent().
 */
export type FieldBatchValue = number | ColorLabel | string | string[] | undefined;

export interface FieldBatchHistoryEvent {
  id: string;
  label: string;
  field: 'rating' | 'colorLabel' | 'captionOverride' | 'keywordsOverride';
  changes: { photoId: string; previousValue: FieldBatchValue }[];
  ts: number;
}
