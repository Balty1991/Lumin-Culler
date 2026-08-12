import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredVisualTheme, applyVisualTheme } from './visualTheme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-visual');
});

describe('readStoredVisualTheme', () => {
  it('defaults to default when nothing is stored', () => {
    expect(readStoredVisualTheme()).toBe('default');
  });

  it('reads a valid stored theme', () => {
    localStorage.setItem('lumin-visual', 'consola');
    expect(readStoredVisualTheme()).toBe('consola');
  });

  it('treats any other stored value as default', () => {
    localStorage.setItem('lumin-visual', 'nope');
    expect(readStoredVisualTheme()).toBe('default');
  });
});

describe('applyVisualTheme', () => {
  it('removes data-visual entirely for default (no stray attribute)', () => {
    document.documentElement.setAttribute('data-visual', 'consola');
    applyVisualTheme('default');
    expect(document.documentElement.hasAttribute('data-visual')).toBe(false);
    expect(localStorage.getItem('lumin-visual')).toBe('default');
  });

  it('sets data-visual for a non-default choice', () => {
    applyVisualTheme('consola');
    expect(document.documentElement.getAttribute('data-visual')).toBe('consola');
    expect(localStorage.getItem('lumin-visual')).toBe('consola');
  });
});
