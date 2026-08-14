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

    expect(result).toEqual({
      personsRestored: 1, modelsRestored: 1, decisionsMatched: 1, decisionsTotal: 1, settingsRestored: false,
      // un backup curat nu sare nimic — vezi validatoarele din backupService.ts
      personsSkipped: 0, modelsSkipped: 0, decisionsSkipped: 0
    });
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

/**
 * Bug real gasit de auditul QA — vezi validatoarele din backupService.ts.
 * Cel mai grav din fisier: pana la acest fix, singura verificare pe continutul
 * unui backup era `Array.isArray` pe cele trei liste, iar inregistrarile
 * ajungeau NEVALIDATE in IndexedDB. Un fisier trunchiat la descarcare (cazul
 * banal) ajungea sa OMOARE PERMANENT scorarea AI, fiindca inregistrarea
 * stricata e persistata: niciun reload si niciun reimport n-o mai repara.
 */
describe('restoreBackup — inregistrari corupte in fisierul de backup', () => {
  beforeEach(async () => {
    await db.photos.clear();
    await db.persons.clear();
    await db.contextModels.clear();
  });

  it('nu mai scrie un contextModel fara `weights` (inainte: predict() arunca TypeError pentru totdeauna)', async () => {
    const broken = { contextKey: 'landscape' } as unknown as BackupData['contextModels'][number];
    const result = await restoreBackup(makeBackup({ contextModels: [broken] }));

    expect(await db.contextModels.toArray()).toEqual([]);
    expect(result.modelsRestored).toBe(0);
    expect(result.modelsSkipped).toBe(1);
  });

  it('respinge un contextModel cu ponderi ne-numerice sau statistici stricate', async () => {
    const models = [
      { contextKey: 'a', weights: { sharpness: 'multa' }, featureStats: {}, bias: 0, sampleCount: 1 },
      { contextKey: 'b', weights: { sharpness: NaN }, featureStats: {}, bias: 0, sampleCount: 1 },
      { contextKey: 'c', weights: {}, featureStats: { sharpness: { mean: 1 } }, bias: 0, sampleCount: 1 },
      { contextKey: 'd', weights: {}, featureStats: {}, bias: 'zero', sampleCount: 1 }
    ] as unknown as BackupData['contextModels'];
    const result = await restoreBackup(makeBackup({ contextModels: models }));

    expect(await db.contextModels.toArray()).toEqual([]);
    expect(result.modelsSkipped).toBe(4);
  });

  it('pastreaza modelele VALIDE si le sare doar pe cele stricate din acelasi fisier', async () => {
    const good = {
      contextKey: 'portrait:known', weights: { sharpness: 0.9 },
      featureStats: { sharpness: { mean: 0.6, m2: 0.1, n: 5 } },
      bias: 0.2, sampleCount: 12, updatedAt: 1000
    };
    const result = await restoreBackup(makeBackup({
      contextModels: [good, { contextKey: 'rupt' }] as unknown as BackupData['contextModels']
    }));

    expect((await db.contextModels.toArray()).map(m => m.contextKey)).toEqual(['portrait:known']);
    expect(result.modelsRestored).toBe(1);
    expect(result.modelsSkipped).toBe(1);
  });

  it('nu mai scrie o persoana fara embeddings (ar ajunge asa in worker-ul de recunoastere)', async () => {
    const result = await restoreBackup(makeBackup({
      persons: [
        { id: 'x', name: 'Ana' },
        { id: 'y', name: 'Bob', embeddings: [] },
        { id: 'z', name: 'Cip', embeddings: [[1, 2, 3]], updatedAt: 1 }
      ] as unknown as BackupData['persons']
    }));

    expect((await db.persons.toArray()).map(p => p.id)).toEqual(['z']);
    expect(result.personsRestored).toBe(1);
    expect(result.personsSkipped).toBe(2);
  });

  it('nu mai scrie un status inventat pe PhotoRecord (inainte: poza disparea din toate filtrele)', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'a.jpg', capturedAt: 1000, status: 'pending' }));
    const result = await restoreBackup(makeBackup({
      photoDecisions: [{ fileName: 'a.jpg', capturedAt: 1000, status: 'GUNOI', rating: 'x' }] as unknown as BackupData['photoDecisions']
    }));

    expect((await db.photos.get('p1'))?.status).toBe('pending');
    expect(result.decisionsMatched).toBe(0);
    expect(result.decisionsSkipped).toBe(1);
  });

  it('aplica in continuare deciziile valide din acelasi fisier', async () => {
    await db.photos.put(makePhoto({ id: 'p1', fileName: 'a.jpg', capturedAt: 1000, status: 'pending' }));
    await db.photos.put(makePhoto({ id: 'p2', fileName: 'b.jpg', capturedAt: 2000, status: 'pending' }));
    const result = await restoreBackup(makeBackup({
      photoDecisions: [
        { fileName: 'a.jpg', capturedAt: 1000, status: 'GUNOI' },
        { fileName: 'b.jpg', capturedAt: 2000, status: 'selected', rating: 4 }
      ] as unknown as BackupData['photoDecisions']
    }));

    expect((await db.photos.get('p1'))?.status).toBe('pending');
    expect((await db.photos.get('p2'))?.status).toBe('selected');
    expect(result.decisionsMatched).toBe(1);
    expect(result.decisionsSkipped).toBe(1);
  });
});
