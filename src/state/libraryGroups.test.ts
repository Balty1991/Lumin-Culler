import { describe, it, expect } from 'vitest';
import { groupBySubject } from './libraryGroups';
import type { PhotoView } from './store';

function photo(id: string, over: Partial<PhotoView> = {}): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], capturedAt: undefined,
    ...over
  };
}
const t = (min: number) => Date.parse('2026-08-26T10:00:00Z') + min * 60_000;

describe('groupBySubject', () => {
  it('persoanele inrolate primele, cea cu mai multe poze in frunte', () => {
    const { photos, bands } = groupBySubject([
      photo('b1', { personNames: ['Bogdan'], faceCount: 1, capturedAt: t(1) }),
      photo('a1', { personNames: ['Ami'], faceCount: 1, capturedAt: t(2) }),
      photo('a2', { personNames: ['Ami'], faceCount: 1, capturedAt: t(3) })
    ], ['Ami', 'Bogdan']);

    expect(photos.map(p => p.id)).toEqual(['a1', 'a2', 'b1']);
    expect(bands.get(0)).toMatchObject({ kind: 'person', name: 'Ami', count: 2 });
    expect(bands.get(2)).toMatchObject({ kind: 'person', name: 'Bogdan', count: 1 });
  });

  it('cronologic in interiorul unei benzi', () => {
    const { photos } = groupBySubject([
      photo('tarziu', { personNames: ['Ami'], faceCount: 1, capturedAt: t(9) }),
      photo('devreme', { personNames: ['Ami'], faceCount: 1, capturedAt: t(1) }),
      photo('nimeni', { capturedAt: t(5) })
    ], ['Ami']);
    expect(photos.slice(0, 2).map(p => p.id)).toEqual(['devreme', 'tarziu']);
  });

  it('oameni necunoscuti si poze fara oameni, la coada, in ordinea asta', () => {
    const { photos, bands } = groupBySubject([
      photo('peisaj'),
      photo('strain', { faceCount: 2 }),
      photo('ami', { personNames: ['Ami'], faceCount: 1 })
    ], ['Ami']);
    expect(photos.map(p => p.id)).toEqual(['ami', 'strain', 'peisaj']);
    expect(bands.get(1)).toMatchObject({ kind: 'others', count: 1 });
    expect(bands.get(2)).toMatchObject({ kind: 'nobody', count: 1 });
  });

  it('o poza cu doua persoane inrolate apare O SINGURA data, la prima', () => {
    // Duplicarea ar fi insemnat aceeasi poza de doua ori in aceeasi grila, cu
    // doua numere de cadru diferite.
    const { photos } = groupBySubject([
      photo('amandoi', { personNames: ['Bogdan', 'Ami'], faceCount: 2 })
    ], ['Ami', 'Bogdan']);
    expect(photos).toHaveLength(1);
  });

  it('fara persoane inrolate, lista ramane neatinsa', () => {
    const list = [photo('a'), photo('b')];
    const { photos, bands } = groupBySubject(list, []);
    expect(photos).toBe(list);
    expect(bands.size).toBe(0);
  });

  it('o singura banda nu merita separator', () => {
    // Un titlu peste o lista care era deja limpede adauga zgomot, nu structura.
    const list = [photo('a', { personNames: ['Ami'], faceCount: 1 })];
    expect(groupBySubject(list, ['Ami']).bands.size).toBe(0);
  });
});
