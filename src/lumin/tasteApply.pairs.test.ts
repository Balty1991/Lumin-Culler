import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { seriesPairs } from './tasteApply';

describe('seriesPairs', () => {
  it('perechi doar din alegerile omului, în aceeași serie', () => {
    const pairs = seriesPairs([
      { id: 'a', groupId: 'g', status: 'selected', aiDecided: false },
      { id: 'b', groupId: 'g', status: 'rejected', aiDecided: false },
      { id: 'c', groupId: 'g', status: 'rejected', aiDecided: true },
      { id: 'd', groupId: 'h', status: 'rejected', aiDecided: false },
      { id: 'e', status: 'selected', aiDecided: false }
    ]);
    expect(pairs).toEqual([{ w: 'a', l: 'b' }]);
  });
});
