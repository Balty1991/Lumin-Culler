import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredTheme, applyTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#0a0b0d" />';
});

describe('readStoredTheme', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('reads light when explicitly stored', () => {
    localStorage.setItem('lumin-theme', 'light');
    expect(readStoredTheme()).toBe('light');
  });

  it('treats any other stored value as dark', () => {
    localStorage.setItem('lumin-theme', 'sepia');
    expect(readStoredTheme()).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('sets data-theme="light" and updates theme-color for light', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f5f5f7');
    expect(localStorage.getItem('lumin-theme')).toBe('light');
  });

  it('removes data-theme entirely for dark (no stray attribute)', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    applyTheme('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0a0b0d');
    expect(localStorage.getItem('lumin-theme')).toBe('dark');
  });
});
