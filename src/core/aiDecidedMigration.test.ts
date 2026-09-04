import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';

/**
 * core/aiDecidedMigration.test.ts
 * Migrarea v10 -> v11: cine a decis pozele care erau DEJA in biblioteca.
 *
 * Fara ea, reparatia barei de severitate ar fi functionat doar pentru poze
 * importate de acum incolo — iar omul care a raportat bugul ar fi ramas exact
 * cu el, in propria lui biblioteca.
 *
 * Se testeaza pe Dexie ADEVARAT (fake-indexeddb), cu o baza scrisa la v10 si
 * redeschisa la v11: o migrare care "pare corecta" citind codul, dar cade la
 * upgrade, strica biblioteci reale si nu se mai poate lua inapoi.
 */
const SCHEMA_V10 = {
  photos: 'id, capturedAt, status, dHash, groupId',
  corrections: '++id, contextKey, ts'
};

async function bazaV10(name: string, photos: unknown[], corrections: unknown[]) {
  const db = new Dexie(name);
  db.version(10).stores(SCHEMA_V10);
  await db.open();
  await db.table('photos').bulkAdd(photos);
  if (corrections.length) await db.table('corrections').bulkAdd(corrections);
  db.close();
}

/** Aceeasi migrare ca in db.ts — tinuta identica aici pentru a o putea rula izolat. */
async function deschideV11(name: string) {
  const db = new Dexie(name);
  db.version(10).stores(SCHEMA_V10);
  db.version(11).stores({}).upgrade(async tx => {
    const deciseDeOm = new Set<string>();
    await tx.table('corrections').each((c: { photoId?: string }) => {
      if (c.photoId) deciseDeOm.add(c.photoId);
    });
    await tx.table('photos').toCollection().modify((p: { id: string; status: string; aiDecided?: boolean }) => {
      if (p.aiDecided !== undefined) return;
      if (p.status === 'candidate') { p.aiDecided = false; return; }
      if (p.status !== 'selected' && p.status !== 'rejected') return;
      p.aiDecided = !deciseDeOm.has(p.id);
    });
  });
  await db.open();
  return db;
}

describe('migrarea deduce cine a decis, din jurnalul de antrenare', () => {
  it('poza care APARE in jurnal a fost decisa de om', async () => {
    const name = 'lumin-mig-1';
    await bazaV10(name,
      [{ id: 'a', status: 'selected' }],
      [{ photoId: 'a', contextKey: 'x', ts: 1 }]);
    const db = await deschideV11(name);
    expect((await db.table('photos').get('a')).aiDecided).toBe(false);
    db.close();
  });

  it('poza care NU apare a fost decisa de motor — si severitatea o poate rescrie', async () => {
    const name = 'lumin-mig-2';
    await bazaV10(name, [{ id: 'b', status: 'rejected' }], []);
    const db = await deschideV11(name);
    expect((await db.table('photos').get('b')).aiDecided).toBe(true);
    db.close();
  });

  it('"candidat" e mereu al omului — motorul nu produce niciodata statusul asta', async () => {
    const name = 'lumin-mig-3';
    await bazaV10(name, [{ id: 'c', status: 'candidate' }], []);
    const db = await deschideV11(name);
    expect((await db.table('photos').get('c')).aiDecided).toBe(false);
    db.close();
  });

  it('pozele nedecise raman neatinse — n-au ce sa aiba', async () => {
    const name = 'lumin-mig-4';
    await bazaV10(name, [{ id: 'd', status: 'review' }, { id: 'e', status: 'pending' }], []);
    const db = await deschideV11(name);
    expect((await db.table('photos').get('d')).aiDecided).toBeUndefined();
    expect((await db.table('photos').get('e')).aiDecided).toBeUndefined();
    db.close();
  });

  it('o valoare deja scrisa NU se suprascrie', async () => {
    const name = 'lumin-mig-5';
    await bazaV10(name, [{ id: 'f', status: 'selected', aiDecided: false }], []);
    const db = await deschideV11(name);
    expect((await db.table('photos').get('f')).aiDecided).toBe(false);
    db.close();
  });

  it('o bibliotecaă amestecată se împarte corect, dintr-o singură trecere', async () => {
    const name = 'lumin-mig-6';
    await bazaV10(name,
      [
        { id: 'p1', status: 'selected' }, { id: 'p2', status: 'selected' },
        { id: 'p3', status: 'rejected' }, { id: 'p4', status: 'review' }
      ],
      [{ photoId: 'p2', contextKey: 'x', ts: 1 }, { photoId: 'p3', contextKey: 'x', ts: 2 }]);
    const db = await deschideV11(name);
    const t = db.table('photos');
    expect((await t.get('p1')).aiDecided).toBe(true);   // motorul
    expect((await t.get('p2')).aiDecided).toBe(false);  // omul
    expect((await t.get('p3')).aiDecided).toBe(false);  // omul
    expect((await t.get('p4')).aiDecided).toBeUndefined();
    db.close();
  });
});
