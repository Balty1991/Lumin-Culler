import { describe, it, expect } from 'vitest';
import { learnedKinds, tasteKind } from './trainingGate';
import type { PhotoView } from '../state/store';

const p = (o: Partial<PhotoView>) => ({ id: Math.random().toString(), faceCount: 0, sceneTags: [], status: 'review', aiDecided: true, ...o }) as unknown as PhotoView;

describe('tasteKind / learnedKinds', () => {
  it('felul pozei din fețe și etichete', () => {
    expect(tasteKind(p({ faceCount: 2 }))).toBe('people');
    expect(tasteKind(p({ sceneTags: ['dog'] }))).toBe('pet');
    expect(tasteKind(p({ sceneTags: ['coffee'] }))).toBe('food');
    expect(tasteKind(p({ sceneTags: ['mountain'] }))).toBe('place');
    expect(tasteKind(p({ sceneTags: ['furniture'] }))).toBe('thing');
  });
  it('oamenii și animalele sunt mereu „învățate”; mâncarea după 3 păstrate de om', () => {
    expect(learnedKinds([]).has('food')).toBe(false);
    const kept = [1, 2, 3].map(() => p({ sceneTags: ['pizza'], status: 'selected', aiDecided: false }));
    expect(learnedKinds(kept).has('food')).toBe(true);
    expect(learnedKinds([]).has('people')).toBe(true);
  });
  it('mai multe scoase decât păstrate: nu e învățat', () => {
    const list = [
      ...[1, 2, 3].map(() => p({ sceneTags: ['lake'], status: 'selected', aiDecided: false })),
      ...[1, 2, 3, 4].map(() => p({ sceneTags: ['lake'], status: 'rejected', aiDecided: false }))
    ];
    expect(learnedKinds(list).has('place')).toBe(false);
  });
});
