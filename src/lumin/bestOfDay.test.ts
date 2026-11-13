import { describe, it, expect } from 'vitest';
import { bestOfDayPicks } from './trainingGate';
import type { PhotoView } from '../state/store';

const day = new Date(2026, 9, 29, 10).getTime();
const p = (id: string, o: Partial<PhotoView> = {}) => ({ id, capturedAt: day, faceCount: 1, status: 'rejected', aiDecided: true, aiScore: 40, bestSmile: 0.5, allEyesOpen: true, sharpness: 70, ...o }) as unknown as PhotoView;

describe('bestOfDayPicks', () => {
  it('o zi cu fetița și nicio poză păstrată primește cea mai bună', () => {
    const picks = bestOfDayPicks([p('a', { aiScore: 30 }), p('b', { aiScore: 55 }), p('c', { aiScore: 45 })]);
    expect(picks).toEqual(['b']);
  });
  it('nu atinge zilele unde omul a hotărât deja', () => {
    expect(bestOfDayPicks([p('a'), p('b'), p('c', { aiDecided: false })])).toEqual([]);
  });
  it('alege din serii diferite', () => {
    const list = Array.from({ length: 12 }, (_, i) => p(`x${i}`, { aiScore: 50 + i, groupId: i < 6 ? 'g1' : 'g2' }));
    const picks = bestOfDayPicks(list);
    expect(picks).toHaveLength(2);
    expect(new Set(picks.map(id => list.find(x => x.id === id)!.groupId)).size).toBe(2);
  });
  it('sare peste pozele cu ochii închiși și cele foarte mișcate', () => {
    expect(bestOfDayPicks([p('a', { allEyesOpen: false, aiScore: 90 }), p('b', { sharpness: 10, aiScore: 80 }), p('c', { aiScore: 20 })])).toEqual(['c']);
  });
});
