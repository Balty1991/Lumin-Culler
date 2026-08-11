import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredAccent, applyAccent } from './accentTheme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-accent');
});

describe('readStoredAccent', () => {
  it('defaults to classic when nothing is stored', () => {
    expect(readStoredAccent()).toBe('classic');
  });

  it('reads a valid stored accent', () => {
    localStorage.setItem('lumin-accent', 'sunset');
    expect(readStoredAccent()).toBe('sunset');
  });

  it('treats any other stored value as classic', () => {
    localStorage.setItem('lumin-accent', 'nope');
    expect(readStoredAccent()).toBe('classic');
  });
});

describe('applyAccent', () => {
  it('removes data-accent entirely for classic (no stray attribute)', () => {
    document.documentElement.setAttribute('data-accent', 'holo');
    applyAccent('classic');
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(localStorage.getItem('lumin-accent')).toBe('classic');
  });

  it('sets data-accent for a non-classic choice', () => {
    applyAccent('sunset');
    expect(document.documentElement.getAttribute('data-accent')).toBe('sunset');
    expect(localStorage.getItem('lumin-accent')).toBe('sunset');
  });
});
