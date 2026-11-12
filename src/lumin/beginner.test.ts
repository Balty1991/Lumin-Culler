import { beforeEach, describe, expect, it } from 'vitest';
import { isBeginner } from './beginner';
import type { PhotoView } from '../state/store';

const p = (status: string, aiDecided = false) => ({ status, aiDecided }) as unknown as PhotoView;
const now = new Date(2026, 10, 12).getTime();

describe('modul de început', () => {
  beforeEach(() => localStorage.clear());
  it('nou: da; după 30 de decizii ale omului: nu', () => {
    expect(isBeginner([p('review')], now)).toBe(true);
    expect(isBeginner(Array.from({ length: 30 }, () => p('selected')), now)).toBe(false);
  });
  it('deciziile AI-ului nu se numără; după 3 zile: nu', () => {
    expect(isBeginner(Array.from({ length: 40 }, () => p('selected', true)), now)).toBe(true);
    expect(isBeginner([], now + 4 * 86_400_000)).toBe(false);
  });
});
