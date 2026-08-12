import { beforeEach, describe, expect, it } from 'vitest';
import {
  readZenMode, writeZenMode,
  readZenAutoDeleteObvious, writeZenAutoDeleteObvious,
  readZenAskOnUncertain, writeZenAskOnUncertain
} from './zenMode';

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

describe('readZenAutoDeleteObvious', () => {
  it('defaults to true when nothing is stored (matches the mockup default)', () => {
    expect(readZenAutoDeleteObvious()).toBe(true);
  });

  it('reads an explicit false', () => {
    writeZenAutoDeleteObvious(false);
    expect(readZenAutoDeleteObvious()).toBe(false);
  });

  it('reads an explicit true', () => {
    writeZenAutoDeleteObvious(false);
    writeZenAutoDeleteObvious(true);
    expect(readZenAutoDeleteObvious()).toBe(true);
  });
});

describe('readZenAskOnUncertain', () => {
  it('defaults to true when nothing is stored (matches the mockup default)', () => {
    expect(readZenAskOnUncertain()).toBe(true);
  });

  it('reads an explicit false', () => {
    writeZenAskOnUncertain(false);
    expect(readZenAskOnUncertain()).toBe(false);
  });
});
