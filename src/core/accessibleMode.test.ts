import { beforeEach, describe, expect, it } from 'vitest';
import { readAccessibleMode, applyAccessibleMode } from './accessibleMode';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-a11y');
});

describe('readAccessibleMode', () => {
  it('defaults to false when nothing is stored', () => {
    expect(readAccessibleMode()).toBe(false);
  });

  it('reads true when explicitly stored', () => {
    localStorage.setItem('lumin-accessible-mode', '1');
    expect(readAccessibleMode()).toBe(true);
  });
});

describe('applyAccessibleMode', () => {
  it('sets data-a11y when enabling', () => {
    applyAccessibleMode(true);
    expect(document.documentElement.getAttribute('data-a11y')).toBe('1');
    expect(localStorage.getItem('lumin-accessible-mode')).toBe('1');
  });

  it('removes data-a11y entirely when disabling (no stray attribute)', () => {
    document.documentElement.setAttribute('data-a11y', '1');
    applyAccessibleMode(false);
    expect(document.documentElement.hasAttribute('data-a11y')).toBe(false);
    expect(localStorage.getItem('lumin-accessible-mode')).toBe('0');
  });
});
