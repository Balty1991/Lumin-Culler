import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createCollection, renameCollection, deleteCollection, addPhotosToCollection, removePhotosFromCollection, loadCollections } from './collections';

describe('collections (foldere personalizate)', () => {
  beforeEach(async () => {
    await db.collections.clear();
  });

  afterEach(async () => {
    await db.collections.clear();
  });

  it('creeaza un folder gol, cu numele curatat de spatii', async () => {
    const record = await createCollection('  Vacanta 2026  ');
    expect(record?.name).toBe('Vacanta 2026');
    expect(record?.memberIds).toEqual([]);
    const all = await loadCollections();
    expect(all).toHaveLength(1);
  });

  it('nu creeaza un folder cu numele gol/doar spatii', async () => {
    const record = await createCollection('   ');
    expect(record).toBeNull();
    expect(await loadCollections()).toEqual([]);
  });

  it('redenumeste un folder existent', async () => {
    const record = await createCollection('Draft');
    await renameCollection(record!.id, 'Nunta Ana & Mihai');
    const all = await loadCollections();
    expect(all[0].name).toBe('Nunta Ana & Mihai');
  });

  it('nu redenumeste cu un nume gol (pastreaza numele vechi)', async () => {
    const record = await createCollection('Original');
    await renameCollection(record!.id, '   ');
    const all = await loadCollections();
    expect(all[0].name).toBe('Original');
  });

  it('sterge un folder', async () => {
    const record = await createCollection('De sters');
    await deleteCollection(record!.id);
    expect(await loadCollections()).toEqual([]);
  });

  it('adauga poze in folder, fara duplicate la reapelare (idempotent)', async () => {
    const record = await createCollection('Selectie');
    await addPhotosToCollection(record!.id, ['p1', 'p2']);
    const updated = await addPhotosToCollection(record!.id, ['p2', 'p3']);
    expect(updated?.memberIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('scoate poze dintr-un folder, restul membrilor raman neschimbati', async () => {
    const record = await createCollection('Selectie');
    await addPhotosToCollection(record!.id, ['p1', 'p2', 'p3']);
    const updated = await removePhotosFromCollection(record!.id, ['p2']);
    expect(updated?.memberIds.sort()).toEqual(['p1', 'p3']);
  });

  it('o poza poate fi in mai multe foldere simultan (N:M)', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');
    await addPhotosToCollection(a!.id, ['p1']);
    await addPhotosToCollection(b!.id, ['p1']);
    const all = await loadCollections();
    expect(all.find(c => c.id === a!.id)?.memberIds).toEqual(['p1']);
    expect(all.find(c => c.id === b!.id)?.memberIds).toEqual(['p1']);
  });

  it('adauga/scoate pe un folder inexistent nu arunca, doar nu face nimic', async () => {
    await expect(addPhotosToCollection('lipsa', ['p1'])).resolves.toBeUndefined();
    await expect(removePhotosFromCollection('lipsa', ['p1'])).resolves.toBeUndefined();
  });
});
