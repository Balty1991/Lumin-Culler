import { describe, expect, it } from 'vitest';
import { buildTastePairs, TASTE_QUIZ_SIZE, type TasteCandidate } from './tastePairs';

function photo(id: string, over: Partial<TasteCandidate> = {}): TasteCandidate {
  return { id, aiScore: 70, sharpness: 70, exposure: 50, faceCount: 0, ...over };
}

describe('buildTastePairs', () => {
  it('prea puține poze: nicio întrebare', () => {
    expect(buildTastePairs([photo('a'), photo('b')])).toEqual([]);
  });

  it('pune serii, calitate și subiect, fără să repete o poză', () => {
    const photos: TasteCandidate[] = [
      photo('s1', { groupId: 'g', aiScore: 80, faceCount: 1 }),
      photo('s2', { groupId: 'g', aiScore: 78, faceCount: 1 }),
      photo('s3', { groupId: 'g', aiScore: 40, faceCount: 1 }),
      photo('blurP', { sharpness: 20, faceCount: 1, aiScore: 30 }),
      photo('sharpP', { sharpness: 90, faceCount: 2, aiScore: 85 }),
      photo('blurL', { sharpness: 15, aiScore: 25 }),
      photo('sharpL', { sharpness: 92, aiScore: 88 }),
      photo('kid', { faceCount: 1, aiScore: 70 }),
      photo('tree', { aiScore: 72 }),
      photo('x1'), photo('x2'), photo('x3'),
      photo('doc', { aside: 'document' })
    ];
    const pairs = buildTastePairs(photos);
    const kinds = new Set(pairs.map(p => p.kind));
    expect(kinds).toEqual(new Set(['series', 'quality', 'subject']));
    const ids = pairs.flatMap(p => [p.aId, p.bId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('doc');
    const series = pairs.find(p => p.kind === 'series')!;
    expect([series.aId, series.bId].sort()).toEqual(['s1', 's2']);
  });

  it('nu depășește mărimea testului', () => {
    const many = Array.from({ length: 80 }, (_, i) => photo('p' + i, { aiScore: i, sharpness: 30 + (i % 60) }));
    expect(buildTastePairs(many).length).toBe(TASTE_QUIZ_SIZE);
  });

  it('aceeași bibliotecă dă aceleași întrebări', () => {
    const many = Array.from({ length: 30 }, (_, i) => photo('p' + i, { aiScore: i * 3 }));
    expect(buildTastePairs(many)).toEqual(buildTastePairs([...many].reverse()));
  });
});
