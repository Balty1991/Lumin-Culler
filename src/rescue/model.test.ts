import { describe, expect, it } from 'vitest';
import { demoPiles, effortSeconds, pileFrom, selectionOf } from './model';

describe('rescue ranking', () => {
  it('uses the same effort table as Rescue.kt', () => {
    expect(effortSeconds('videos', 2)).toBeCloseTo(5.4);
    expect(effortSeconds('messengers', 3)).toBeCloseTo(6.36);
    expect(effortSeconds('duplicates', 2)).toBeCloseTo(5.16);
    expect(effortSeconds('screenshots', 1)).toBeCloseTo(5.08);
    expect(effortSeconds('bursts', 2)).toBeCloseTo(7.5);
    expect(effortSeconds('blurry', 1)).toBeCloseTo(5.1);
  });

  it('ranks the sample gallery by suggested gigabytes per second', () => {
    const piles = demoPiles();
    expect(piles.map(pile => pile.id)).toEqual([
      'videos',
      'duplicates',
      'bursts',
      'messengers',
      'blurry',
      'screenshots'
    ]);
    expect(piles[0].gbPerSecond).toBeGreaterThan(piles[1].gbPerSecond);
    expect(piles[0].suggestedBytes).toBe(2_420_000_000);
    expect(piles[0].effortSeconds).toBeCloseTo(5.4);
  });

  it('leaves the only chat copy and the recent screenshot unchecked', () => {
    const piles = demoPiles();
    const chat = piles.find(pile => pile.id === 'messengers')!;
    const shots = piles.find(pile => pile.id === 'screenshots')!;
    expect(chat.items.find(item => item.id === 'm4')).toMatchObject({ suggested: false, reason: 'chatOnly' });
    expect(shots.items.find(item => item.id === 's2')).toMatchObject({ suggested: false, reason: 'screenshotRecent' });
    expect(chat.items.find(item => item.id === 'm3')?.suggested).toBe(true);
  });

  it('gives an empty suggestion no effort and no rank weight', () => {
    const pile = pileFrom('blurry', [
      { id: 'x', name: 'a.jpg', bytes: 10, suggested: false, reason: 'blurry' }
    ]);
    expect(pile?.suggestedCount).toBe(0);
    expect(pile?.effortSeconds).toBe(0);
    expect(pile?.gbPerSecond).toBe(0);
  });

  it('counts only checked files that are not already set aside', () => {
    const [videos] = demoPiles();
    const checked = new Set(['v1', 'v2']);
    expect(selectionOf(videos.items, checked, new Set())).toMatchObject({ bytes: 2_420_000_000, count: 2, leftOut: 0 });
    expect(selectionOf(videos.items, checked, new Set(['v1']))).toMatchObject({ bytes: 820_000_000, count: 1, leftOut: 0 });
  });
});
