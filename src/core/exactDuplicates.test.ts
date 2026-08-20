import { describe, it, expect } from 'vitest';
import {
  findExactDuplicates, summariseDuplicates, allDuplicateIds, type DuplicateCandidate
} from './exactDuplicates';

const p = (id: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id, dHash: 'aaaa', sizeBytes: 1000, fileName: id + '.jpg', importedAt: 100, status: 'pending', ...over
});

describe('findExactDuplicates', () => {
  it('nu vede duplicate acolo unde nu sunt', () => {
    expect(findExactDuplicates([p('a'), p('b', { dHash: 'bbbb' })])).toEqual([]);
  });

  it('aceeasi amprenta si aceeasi dimensiune = aceeasi poza', () => {
    const sets = findExactDuplicates([p('a'), p('b')]);
    expect(sets).toHaveLength(1);
    expect(sets[0].duplicateIds).toEqual(['b']);
  });

  it('aceeasi amprenta dar alta dimensiune NU e copie — e alta versiune', () => {
    // acelasi cadru re-comprimat (WhatsApp) e o poza diferita ca fisier: o
    // propunem prin gruparea de serii, nu ca stergere sigura
    expect(findExactDuplicates([p('a'), p('b', { sizeBytes: 240 })])).toEqual([]);
  });

  it('pozele fara dimensiune cunoscuta nu intra niciodata in perechi', () => {
    expect(findExactDuplicates([p('a', { sizeBytes: undefined }), p('b', { sizeBytes: undefined })])).toEqual([]);
    expect(findExactDuplicates([p('a', { sizeBytes: 0 }), p('b')])).toEqual([]);
  });

  it('pastreaza copia pe care utilizatorul a pastrat-o deja', () => {
    const sets = findExactDuplicates([
      p('veche', { importedAt: 1 }),
      p('aleasa-de-mine', { importedAt: 900, status: 'selected' })
    ]);
    expect(sets[0].keepId).toBe('aleasa-de-mine');
  });

  it('fara nicio decizie, pastreaza cea mai veche — originalul, nu copia', () => {
    const sets = findExactDuplicates([
      p('copia', { capturedAt: 5000 }),
      p('originalul', { capturedAt: 1000 })
    ]);
    expect(sets[0].keepId).toBe('originalul');
    expect(sets[0].duplicateIds).toEqual(['copia']);
  });

  it('cade pe data importului cand nu se stie ora capturii', () => {
    const sets = findExactDuplicates([p('a', { importedAt: 50 }), p('b', { importedAt: 10 })]);
    expect(sets[0].keepId).toBe('b');
  });

  it('socoteste locul eliberat, nu spatiul total', () => {
    // trei copii de 1000 => se elibereaza 2000, nu 3000
    const sets = findExactDuplicates([p('a'), p('b'), p('c')]);
    expect(sets[0].wastedBytes).toBe(2000);
    expect(sets[0].duplicateIds).toHaveLength(2);
  });

  it('grupurile care elibereaza cel mai mult loc vin primele', () => {
    const sets = findExactDuplicates([
      p('mic-1', { dHash: 'm', sizeBytes: 10 }), p('mic-2', { dHash: 'm', sizeBytes: 10 }),
      p('mare-1', { dHash: 'M', sizeBytes: 9000 }), p('mare-2', { dHash: 'M', sizeBytes: 9000 })
    ]);
    expect(sets[0].duplicateIds[0]).toBe('mare-2');
  });

  it('rezultatul nu depinde de ordinea in care primeste pozele', () => {
    const input = [p('a'), p('b'), p('c')];
    expect(findExactDuplicates([...input].reverse())).toEqual(findExactDuplicates(input));
  });

  it('rezuma peste toate grupurile', () => {
    const sets = findExactDuplicates([
      p('a'), p('b'), p('c'),
      p('x', { dHash: 'x', sizeBytes: 500 }), p('y', { dHash: 'x', sizeBytes: 500 })
    ]);
    expect(summariseDuplicates(sets)).toEqual({ sets: 2, duplicates: 3, wastedBytes: 2500 });
    expect(allDuplicateIds(sets).sort()).toEqual(['b', 'c', 'y']);
  });

  it('rezumatul unei biblioteci curate e zero peste tot', () => {
    expect(summariseDuplicates([])).toEqual({ sets: 0, duplicates: 0, wastedBytes: 0 });
  });
});
