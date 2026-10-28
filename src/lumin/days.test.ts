import { describe, it, expect } from 'vitest';
import { groupDays } from './days';

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();

describe('groupDays', () => {
  it('splits photos by day, newest first, and finds series with their best frame', () => {
    const days = groupDays([
      { id: 'a', capturedAt: at(27, 10), importedAt: 0, status: 'selected', aiScore: 70, groupId: 'g' },
      { id: 'b', capturedAt: at(27, 10), importedAt: 0, status: 'rejected', aiScore: 90, groupId: 'g' },
      { id: 'c', capturedAt: at(28, 9), importedAt: 0, status: 'review', aiScore: 50 },
      { id: 'd', capturedAt: at(28, 9), importedAt: 0, status: 'selected', aiScore: 60, aside: 'document' }
    ]);
    expect(days.map(d => d.photos.length)).toEqual([2, 2]);
    expect(days[0].waiting.map(p => p.id)).toEqual(['c']);
    expect(days[0].aside.map(p => p.id)).toEqual(['d']);
    expect(days[0].kept).toEqual([]);
    expect(days[1].series).toHaveLength(1);
    expect(days[1].series[0].best.id).toBe('a');
  });
});
