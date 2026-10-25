import { describe, expect, it } from 'vitest';
import { demoPiles } from './model';
import { SCAN_FIRST_MS, scanBudgetMs, scanFrames, streamDemoScan } from './scan';

describe('streamed demo scan', () => {
  it('reports gigabytes on the first frame and finishes within 1.5s', () => {
    const frames = scanFrames();
    expect(frames[0].bytes).toBe(2_420_000_000);
    expect(frames[0].bytes).toBeLessThan(frames[frames.length - 1].bytes);
    expect(frames[frames.length - 1].piles.map(pile => pile.id)).toEqual(demoPiles().map(pile => pile.id));
    expect(SCAN_FIRST_MS).toBeLessThan(1000);
    expect(scanBudgetMs()).toBeLessThan(1500);
  });

  it('emits the first total before the last pile arrives', async () => {
    const seen: number[] = [];
    await streamDemoScan(frame => seen.push(frame.bytes), async () => {});
    expect(seen[0]).toBe(2_420_000_000);
    expect(seen[0]).toBeLessThan(seen[seen.length - 1]);
    expect(seen).toHaveLength(scanFrames().length);
  });
});
