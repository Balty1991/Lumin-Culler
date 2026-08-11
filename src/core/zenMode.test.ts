import { beforeEach, describe, expect, it } from 'vitest';
import { readZenMode, writeZenMode } from './zenMode';

beforeEach(() => {
  localStorage.clear();
});

describe('readZenMode', () => {
  it('defaults to false when nothing is stored', () => {
    expect(readZenMode()).toBe(false);
  });

  it('reads true when explicitly stored', () => {
    localStorage.setItem('lumin-zen-mode', '1');
    expect(readZenMode()).toBe(true);
  });
});

describe('writeZenMode', () => {
  it('persists on', () => {
    writeZenMode(true);
    expect(localStorage.getItem('lumin-zen-mode')).toBe('1');
    expect(readZenMode()).toBe(true);
  });

  it('persists off', () => {
    localStorage.setItem('lumin-zen-mode', '1');
    writeZenMode(false);
    expect(localStorage.getItem('lumin-zen-mode')).toBe('0');
    expect(readZenMode()).toBe(false);
  });
});
