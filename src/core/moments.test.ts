import { describe, it, expect } from 'vitest';
import { momentChanges, splitMoments, keepPerMoment } from './moments';

const t0 = new Date(2026, 9, 28, 12, 0).getTime();
const photo = (id: string, minute: number, aiScore: number, status = 'selected', locked = false) =>
  ({ id, capturedAt: t0 + minute * 60_000, aiScore, status, locked });

describe('moments', () => {
  it('keeps the best 2 of 9 near shots on balanced', () => {
    const nine = Array.from({ length: 9 }, (_, i) => photo(`p${i}`, i * 0.2, 90 - i));
    const changes = momentChanges(nine, 'balanced');
    expect(changes.size).toBe(7);
    expect(changes.has('p0')).toBe(false);
    expect(changes.has('p1')).toBe(false);
  });

  it('splits moments on a gap and leaves small moments alone', () => {
    const list = [photo('a', 0, 80), photo('b', 1, 70), photo('c', 30, 60)];
    expect(splitMoments(list).map(m => m.length)).toEqual([2, 1]);
    expect(momentChanges(list, 'strict').size).toBe(0);
  });

  it('never touches user decisions and counts user keeps first', () => {
    const list = [photo('u', 0, 50, 'selected', true), photo('a', 0.5, 95), photo('b', 1, 90), photo('r', 1.2, 40, 'review')];
    const changes = momentChanges(list, 'strict');
    expect(changes.has('u')).toBe(false);
    expect([...changes.keys()].sort()).toEqual(['a', 'b', 'r']);
  });

  it('scales the quota with strictness', () => {
    expect(keepPerMoment(9, 'strict')).toBe(1);
    expect(keepPerMoment(9, 'balanced')).toBe(2);
    expect(keepPerMoment(9, 'lax')).toBe(3);
  });

  it('keeps one more frame and puts favourite people first', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...photo(`p${i}`, i * 0.2, 90 - i), priority: i === 8 }));
    const changes = momentChanges(nine, 'balanced', { priorityBonus: 1 });
    expect(changes.size).toBe(6);
    expect(changes.has('p8')).toBe(false);
  });

  it('seller mode keeps only the sharpest frame', () => {
    const list = [
      { ...photo('a', 0, 95), sharpness: 40 },
      { ...photo('b', 0.5, 80), sharpness: 90 },
      { ...photo('c', 1, 70), sharpness: 60 }
    ];
    const changes = momentChanges(list, 'lax', { maxPerMoment: 1, rankBy: 'sharpness' });
    expect([...changes.keys()].sort()).toEqual(['a', 'c']);
  });
});
