// Bug real gasit de auditul QA: acest fisier nu avea niciun test dedicat,
// desi detine tocmai logica de potrivire/atomicitate a restaurarii unui
// backup — golul care a lasat cele doua bug-uri de mai jos nedetectate.
// fake-indexeddb polyfilleaza IndexedDB in Node, ca `db` (Dexie) sa
// functioneze real (nu mockat) in acest fisier de test.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type PhotoRecord } from './db';
import { restoreBackup, type BackupData } from './backupService';

function makePhoto(overrides: Partial<PhotoRecord> & { id: string }): PhotoRecord {
  return {
    fileName: 'IMG_0001.jpg', capturedAt: 1000, importedAt: 1000,
    width: 100, height: 100, dHash: '0', status: 'pending',
    ...overrides
  };
}

function makeBackup(overrides: Partial<BackupData> = {}): BackupData {
  return {
    version: 2, exportedAt: Date.now(),
    persons: [], contextModels: [], photoDecisions: [],
    ...overrides
  };
}

describe('restoreBackup', () => {
  beforeEach(async () => {
    await db.photos.clear();
    await db.persons.clear();
    await db.contextModels.clear();
  });

  afterEach(async () => {
    await db.photos.clear();
    await db.persons.clear();
    await db.contextModels.clear();
  });

  it('restores persons, contextModels and matches a decision by fingerprint', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'pending' }));
    const backup = makeBackup({
      persons: [{ id: 'a1', name: 'Ami', embeddings: [[1, 2, 3]], updatedAt: 1 }],
      contextModels: [{ contextKey: 'portrait:known', weights: {}, bias: 0, featureStats: {}, sampleCount: 5, updatedAt: 1 }],
      photoDecisions: [{ fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'selected', rating: 4 }]
    });

    const result = await restoreBackup(backup);

    expect(result).toEqual({ personsRestored: 1, modelsRestored: 1, decisionsMatched: 1, decisionsTotal: 1, settingsRestored: false });
    const persons = await db.persons.toArray();
    expect(persons).toHaveLength(1);
    expect(persons[0].name).toBe('Ami');
    const photo = await db.photos.get('p1');
    expect(photo?.status).toBe('selected');
    expect(photo?.rating).toBe(4);
  });

  it('leaves an unmatched decision alone (no photo with that fingerprint)', async () => {
    const backup = makeBackup({ photoDecisions: [{ fileName: 'nu-exista.jpg', capturedAt: 1, status: 'selected' }] });
    const result = await restoreBackup(backup);
    expect(result.decisionsMatched).toBe(0);
    expect(result.decisionsTotal).toBe(1);
  });

  // Bug real gasit de auditul QA: doua poze CURENTE cu acelasi nume+data
  // capturii (carduri de memorie diferite, burst suprapus) — inainte de fix,
  // un Map cheie unica pastra doar ULTIMA, iar cealalta nu primea niciodata
  // decizia restaurata, silentios.
  it('applies a restored decision to every current photo sharing the same fingerprint, not just the last one', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'pending' }));
    await db.photos.put(makePhoto({ id: 'p2', fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'pending' }));
    const backup = makeBackup({ photoDecisions: [{ fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'rejected' }] });

    const result = await restoreBackup(backup);

    expect(result.decisionsMatched).toBe(2);
    expect((await db.photos.get('p1'))?.status).toBe('rejected');
    expect((await db.photos.get('p2'))?.status).toBe('rejected');
  });

  it('skips a photo whose status/rating already match (no redundant write, not counted as matched)', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'selected', rating: 5 }));
    const backup = makeBackup({ photoDecisions: [{ fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'selected', rating: 5 }] });
    const result = await restoreBackup(backup);
    expect(result.decisionsMatched).toBe(0);
  });

  // Bug real gasit de auditul QA: scrierile (persons + contextModels + bucla
  // de decizii) rulau in afara oricarei tranzactii Dexie — o eroare la
  // mijlocul restaurarii lasa o stare partiala (unele scrise, altele nu).
  // Fortam o eroare in interiorul buclei de decizii (dupa ce persons/
  // contextModels s-ar fi scris deja in varianta veche) si verificam ca
  // ABSOLUT NIMIC nu a fost efectiv persistat.
  it('rolls back everything (persons, contextModels, decisions) when a write fails partway through', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'pending' }));
    const updateSpy = vi.spyOn(db.photos, 'update').mockRejectedValue(new Error('eroare simulata la mijlocul restaurarii'));

    const backup = makeBackup({
      persons: [{ id: 'a1', name: 'Ami', embeddings: [[1]], updatedAt: 1 }],
      contextModels: [{ contextKey: 'portrait:known', weights: {}, bias: 0, featureStats: {}, sampleCount: 5, updatedAt: 1 }],
      photoDecisions: [{ fileName: 'IMG_0001.jpg', capturedAt: 1000, status: 'selected' }]
    });

    try {
      await expect(restoreBackup(backup)).rejects.toThrow();
      expect(updateSpy).toHaveBeenCalled(); // confirma ca eroarea chiar a fost declansata din interiorul tranzactiei
      expect(await db.persons.toArray()).toEqual([]);       // NU a supravietuit rollback-ului
      expect(await db.contextModels.toArray()).toEqual([]); // NU a supravietuit rollback-ului
      expect((await db.photos.get('p1'))?.status).toBe('pending'); // decizia nu s-a aplicat
    } finally {
      updateSpy.mockRestore();
    }
  });
});
