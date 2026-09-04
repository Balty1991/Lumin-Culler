import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';

/**
 * core/burstTimestamp.test.ts
 * Data unui FIȘIER nu e momentul declanșării.
 *
 * Bug raportat cu doua capturi: un peisaj montan insorit si un portret la
 * lumina de lumanare, grupate ca "serie de 2 cadre similare". N-aveau nimic in
 * comun — dar erau amandoua descarcate, deci fara EXIF, deci `capturedAt`
 * cazuse pe data fisierului, adica pe momentul DESCARCARII. Descarcate in
 * acelasi minut, pareau facute in acelasi minut, si asa deblocau pragul de
 * asemanare LARG gandit pentru doua apasari de declansator.
 *
 * Migrarea de mai jos repara si pozele deja importate. Se testeaza pe Dexie
 * ADEVARAT (fake-indexeddb), cu o baza scrisa la v11 si redeschisa la v12: o
 * migrare care pare corecta citind codul dar cade la upgrade strica biblioteci
 * reale si nu se mai poate lua inapoi.
 */
const SCHEMA = { photos: 'id, capturedAt, status, dHash, groupId', analyses: 'photoId, sceneType, aiScore' };

async function bazaV11(name: string, photos: unknown[], analyses: unknown[]) {
  const db = new Dexie(name);
  db.version(11).stores(SCHEMA);
  await db.open();
  await db.table('photos').bulkAdd(photos);
  await db.table('analyses').bulkAdd(analyses);
  db.close();
}

/** Aceeasi migrare ca in db.ts, rulata izolat. */
async function deschideV12(name: string) {
  const db = new Dexie(name);
  db.version(11).stores(SCHEMA);
  db.version(12).stores({}).upgrade(async tx => {
    const cuExif = new Set<string>();
    await tx.table('analyses').each((a: Record<string, unknown>) => {
      if (a.cameraMake !== undefined || a.cameraModel !== undefined
        || a.iso !== undefined || a.fNumber !== undefined || a.exposureTime !== undefined) {
        cuExif.add(a.photoId as string);
      }
    });
    await tx.table('photos').toCollection().modify((p: Record<string, unknown>) => {
      if (p.capturedAtExact !== undefined) return;
      p.capturedAtExact = cuExif.has(p.id as string);
    });
  });
  await db.open();
  return db;
}

describe('migrarea deduce daca data e a aparatului sau a fisierului', () => {
  it('o poza cu metadate de aparat a avut EXIF — data e de incredere', async () => {
    const n = 'lumin-ts-1';
    await bazaV11(n, [{ id: 'a', capturedAt: 1 }], [{ photoId: 'a', cameraMake: 'Xiaomi' }]);
    const db = await deschideV12(n);
    expect((await db.table('photos').get('a')).capturedAtExact).toBe(true);
    db.close();
  });

  it('doar ISO e de ajuns — EXIF-ul a existat, chiar daca nu scrie marca', async () => {
    const n = 'lumin-ts-2';
    await bazaV11(n, [{ id: 'b', capturedAt: 1 }], [{ photoId: 'b', iso: 400 }]);
    const db = await deschideV12(n);
    expect((await db.table('photos').get('b')).capturedAtExact).toBe(true);
    db.close();
  });

  it('o poza FARA niciun metadat de aparat — cazul pozei descarcate', async () => {
    const n = 'lumin-ts-3';
    await bazaV11(n, [{ id: 'c', capturedAt: 1 }], [{ photoId: 'c', aiScore: 80 }]);
    const db = await deschideV12(n);
    expect((await db.table('photos').get('c')).capturedAtExact).toBe(false);
    db.close();
  });

  it('o valoare deja scrisa NU se suprascrie', async () => {
    const n = 'lumin-ts-4';
    await bazaV11(n, [{ id: 'd', capturedAt: 1, capturedAtExact: true }], [{ photoId: 'd', aiScore: 80 }]);
    const db = await deschideV12(n);
    expect((await db.table('photos').get('d')).capturedAtExact).toBe(true);
    db.close();
  });

  it('o biblioteca amestecata se imparte corect', async () => {
    const n = 'lumin-ts-5';
    await bazaV11(n,
      [{ id: 'p1', capturedAt: 1 }, { id: 'p2', capturedAt: 2 }, { id: 'p3', capturedAt: 3 }],
      [{ photoId: 'p1', cameraModel: 'Redmi' }, { photoId: 'p2', aiScore: 1 }, { photoId: 'p3', exposureTime: 0.004 }]);
    const db = await deschideV12(n);
    const t = db.table('photos');
    expect((await t.get('p1')).capturedAtExact).toBe(true);
    expect((await t.get('p2')).capturedAtExact).toBe(false);
    expect((await t.get('p3')).capturedAtExact).toBe(true);
    db.close();
  });
});
