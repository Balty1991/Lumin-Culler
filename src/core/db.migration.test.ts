// Bug real gasit de auditul QA (suggestion, scalabilitate): vezi v6 in db.ts —
// pozele negrupate nu primeau NICIODATA campul groupId (absent, nu doar gol),
// asa ca interogarea "poze negrupate" din importPipeline.ts nu putea folosi
// indexul si scana intreaga tabela la fiecare import. Acest test simuleaza
// o baza REALA ramasa la schema v5 (groupId complet absent pe o poza veche),
// deschide LuminDB (versionata pana la v6) peste ea si verifica ca migrarea
// backfilleaza groupId: '' — singurul mod de a testa efectiv o secventa de
// upgrade Dexie, spre deosebire de restul testelor care deschid direct la
// ultima versiune.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';

const DB_NAME = 'lumin-culler-v2';

describe('LuminDB v6 migration', () => {
  it('backfills groupId: "" for photos left with no groupId field from a pre-v6 database', async () => {
    // Recream doar schema v5 (nu importam db.ts inca, ca sa nu deschidem
    // direct la v6) si inseram o poza fara campul groupId deloc.
    const legacyDb = new Dexie(DB_NAME);
    legacyDb.version(5).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    });
    await legacyDb.open();
    await legacyDb.table('photos').add({
      id: 'legacy-1', fileName: 'IMG_0001.jpg', capturedAt: 1000, importedAt: 1000,
      width: 100, height: 100, dHash: '0', status: 'pending'
      // groupId intentionat absent — comportamentul real inainte de v6
    });
    legacyDb.close();

    // Import dinamic, DUPA ce baza legacy exista deja pe disc — declanseaza
    // secventa completa de upgrade (v1..v6) cand LuminDB se deschide.
    const { db } = await import('./db');
    const migrated = await db.photos.get('legacy-1');

    expect(migrated?.groupId).toBe('');
    // Verificam si ca indexul chiar o gaseste acum (nu doar campul in sine).
    const viaIndex = await db.photos.where('groupId').equals('').toArray();
    expect(viaIndex.map(p => p.id)).toContain('legacy-1');
  });
});
