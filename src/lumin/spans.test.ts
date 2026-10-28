import { describe, expect, it } from 'vitest';
import { computeSpans } from './GalleryWall';
import type { PhotoView } from '../state/store';

const kept = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, status: 'selected', aiScore: 90 }) as unknown as PhotoView);

/** Așază dalele ca CSS grid cu auto-flow dense și numără celulele goale înaintea ultimului rând. */
function holes(spans: ('big' | 'tall' | '')[], cols: number): number {
  const grid: boolean[][] = [];
  const free = (r: number, c: number) => !(grid[r]?.[c]);
  const take = (r: number, c: number) => { (grid[r] ??= [])[c] = true; };
  for (const s of spans) {
    const w = s === 'big' ? 2 : 1, h = s ? 2 : 1;
    placed: for (let r = 0; ; r++) for (let c = 0; c + w <= cols; c++) {
      let ok = true;
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (!free(r + dr, c + dc)) ok = false;
      if (ok) { for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) take(r + dr, c + dc); break placed; }
    }
  }
  const rows = grid.length;
  let empty = 0;
  for (let r = 0; r < rows - 2; r++) for (let c = 0; c < cols; c++) if (free(r, c)) empty++;
  return empty;
}

describe('computeSpans', () => {
  it('nu lasă goluri când toate pozele sunt păstrate și bune', () => {
    for (const cols of [3, 4, 5] as const) expect(holes(computeSpans(kept(40), cols), cols)).toBe(0);
  });
  it('tot pune poze mari', () => {
    expect(computeSpans(kept(20), 3).filter(s => s === 'big').length).toBeGreaterThan(3);
  });
});
