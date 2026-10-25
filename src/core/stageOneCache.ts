/**
 * core/stageOneCache.ts
 * Rezultatul etapei 1, ca o rescanare să nu mai decodeze aceeași poză.
 *
 * Se păstrează amprenta, măsurătorile ieftine și JPEG-urile deja reduse
 * (previzualizare și miniatură), nu fișierul original. La a doua trecere,
 * dacă mărimea și data nu s-au schimbat, etapa 1 este o citire din IndexedDB.
 */
import { db, type StageOneCacheRecord } from './db';

export type { StageOneCacheRecord };

/** Câte amprente ținem. Peste prag, cele mai vechi ies. JPEG-urile reduse nu au voie să crească la nesfârșit. */
export const STAGE_ONE_CACHE_CAP = 400;

export async function loadStageOne(key: string): Promise<StageOneCacheRecord | null> {
  if (!db.stageOneCache) return null;
  try {
    return (await db.stageOneCache.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function saveStageOne(record: StageOneCacheRecord): Promise<void> {
  if (!db.stageOneCache) return;
  try {
    await db.stageOneCache.put(record);
    const count = await db.stageOneCache.count();
    if (count <= STAGE_ONE_CACHE_CAP) return;
    const overflow = count - STAGE_ONE_CACHE_CAP;
    const oldest = await db.stageOneCache.orderBy('updatedAt').limit(overflow).primaryKeys();
    if (oldest.length) await db.stageOneCache.bulkDelete(oldest);
  } catch {
    // cache-ul e o scurtătură, nu o condiție a importului
  }
}
