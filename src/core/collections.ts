/**
 * core/collections.ts
 * Foldere personalizate (cerinta directa a utilizatorului) — CRUD subtire
 * peste db.collections (vezi CollectionRecord in core/db.ts pentru
 * rationamentul modelului de date: apartenenta traieste pe memberIds, nu pe
 * PhotoRecord).
 */
import { db, type CollectionRecord } from './db';

export async function loadCollections(): Promise<CollectionRecord[]> {
  return db.collections.toArray();
}

export async function createCollection(name: string): Promise<CollectionRecord | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const record: CollectionRecord = { id: crypto.randomUUID(), name: trimmed, createdAt: Date.now(), memberIds: [] };
  await db.collections.put(record);
  return record;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.collections.update(id, { name: trimmed });
}

export async function deleteCollection(id: string): Promise<void> {
  await db.collections.delete(id);
}

/** Idempotent — o poza deja in folder nu apare de doua ori (Set la unire). */
export async function addPhotosToCollection(id: string, photoIds: string[]): Promise<CollectionRecord | undefined> {
  const record = await db.collections.get(id);
  if (!record) return undefined;
  const memberIds = [...new Set([...record.memberIds, ...photoIds])];
  await db.collections.update(id, { memberIds });
  return { ...record, memberIds };
}

export async function removePhotosFromCollection(id: string, photoIds: string[]): Promise<CollectionRecord | undefined> {
  const record = await db.collections.get(id);
  if (!record) return undefined;
  const toRemove = new Set(photoIds);
  const memberIds = record.memberIds.filter(pid => !toRemove.has(pid));
  await db.collections.update(id, { memberIds });
  return { ...record, memberIds };
}
