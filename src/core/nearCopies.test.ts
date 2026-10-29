import { describe, expect, it } from 'vitest';
import { findNearCopies, isChatCopyName } from './nearCopies';
import type { DuplicateCandidate } from './exactDuplicates';

const base = '0110100111010010101101001011010010110100101101001011010010110100';
const flip = (h: string, ...bits: number[]) => h.split('').map((c, i) => (bits.includes(i) ? (c === '1' ? '0' : '1') : c)).join('');
const p = (id: string, fileName: string, dHash: string, sizeBytes: number, status: DuplicateCandidate['status'] = 'pending'): DuplicateCandidate =>
  ({ id, fileName, dHash, sizeBytes, importedAt: 0, status });

describe('copiile de pe WhatsApp', () => {
  it('recunoaște numele aplicațiilor de mesaje', () => {
    expect(isChatCopyName('IMG-20240512-WA0007.jpg')).toBe(true);
    expect(isChatCopyName('IMG_20240512_101500.jpg')).toBe(false);
  });

  it('păstrează originalul mare și scoate copia comprimată', () => {
    const sets = findNearCopies([p('orig', 'IMG_1.jpg', base, 4_000_000), p('wa', 'IMG-20240512-WA0007.jpg', flip(base, 3, 40), 180_000)]);
    expect(sets).toEqual([{ keepId: 'orig', copyIds: ['wa'], wastedBytes: 180_000 }]);
  });

  it('nu atinge o rafală: două cadre ale camerei, fără copie din mesaje', () => {
    expect(findNearCopies([p('a', 'IMG_1.jpg', base, 4_000_000), p('b', 'IMG_2.jpg', flip(base, 7), 3_900_000)])).toEqual([]);
  });

  it('nu leagă poze prea diferite', () => {
    expect(findNearCopies([p('a', 'IMG_1.jpg', base, 4_000_000), p('b', 'IMG-1-WA0001.jpg', flip(base, 1, 20, 33, 50, 60), 100_000)])).toEqual([]);
  });

  it('o copie păstrată de om rămâne', () => {
    const sets = findNearCopies([p('orig', 'IMG_1.jpg', base, 4_000_000), p('wa', 'IMG-1-WA0001.jpg', base, 100_000, 'selected')]);
    expect(sets).toEqual([{ keepId: 'wa', copyIds: ['orig'], wastedBytes: 4_000_000 }]);
  });
});
