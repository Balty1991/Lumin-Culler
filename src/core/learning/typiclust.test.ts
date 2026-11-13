import { describe, expect, it } from 'vitest';
import { typicalPicks } from './typiclust';

describe('typicalPicks', () => {
  it('ia câte una din fiecare grup, cea din mijloc', () => {
    const blob = (cx: number, cy: number) => [[cx, cy], [cx + 0.1, cy], [cx - 0.1, cy], [cx, cy + 0.1], [cx, cy - 0.1]];
    const xs = [...blob(0, 0), ...blob(10, 0), ...blob(0, 10)];
    const picks = typicalPicks(xs, 3);
    expect(picks).toHaveLength(3);
    expect(new Set(picks.map(i => Math.floor(i / 5))).size).toBe(3);
    expect(picks.every(i => i % 5 === 0)).toBe(true);
  });
  it('cu mai puține poze decât grupuri, le ia pe toate', () => {
    expect(typicalPicks([[0], [1]], 5).sort()).toEqual([0, 1]);
  });
});
