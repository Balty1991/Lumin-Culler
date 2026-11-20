import { describe, it, expect } from 'vitest';
import { mismatchedMembers } from './seriesRepair';

const v = (w: number) => Array.from({ length: 512 }, (_, k) => (k === 0 ? w : k === 1 ? Math.sqrt(1 - w * w) : 0));

describe('mismatchedMembers', () => {
  it('scoate poza din altă scenă; seria cu două poze dispare', () => {
    expect(mismatchedMembers(new Map([['g', [{ id: 'a', clip: v(1) }, { id: 'b', clip: v(0.6) }]]])).sort()).toEqual(['a', 'b']);
  });
  it('păstrează seria reală și scoate doar intrusul', () => {
    const g = [{ id: 'a', clip: v(1) }, { id: 'b', clip: v(0.95) }, { id: 'c', clip: v(0.3) }];
    expect(mismatchedMembers(new Map([['g', g]]))).toEqual(['c']);
  });
  it('fără amprente nu atinge nimic', () => {
    expect(mismatchedMembers(new Map([['g', [{ id: 'a' }, { id: 'b' }]]]))).toEqual([]);
  });
});
