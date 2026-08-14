import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredTheme, applyTheme, resolveTheme, readSystemColorScheme } from './theme';

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

  it('reads auto when explicitly stored', () => {
    localStorage.setItem('lumin-theme', 'auto');
    expect(readStoredTheme()).toBe('auto');
  });
});

describe('resolveTheme', () => {
  it('returns dark/light unchanged, ignoring the time', () => {
    expect(resolveTheme('dark', new Date(2026, 0, 1, 12))).toBe('dark');
    expect(resolveTheme('light', new Date(2026, 0, 1, 2))).toBe('light');
  });

  it('resolves auto to light during the day (7:00-19:59)', () => {
    expect(resolveTheme('auto', new Date(2026, 0, 1, 7, 0))).toBe('light');
    expect(resolveTheme('auto', new Date(2026, 0, 1, 19, 59))).toBe('light');
  });

  it('resolves auto to dark outside daytime hours', () => {
    expect(resolveTheme('auto', new Date(2026, 0, 1, 6, 59))).toBe('dark');
    expect(resolveTheme('auto', new Date(2026, 0, 1, 20, 0))).toBe('dark');
    expect(resolveTheme('auto', new Date(2026, 0, 1, 23))).toBe('dark');
  });

  /**
   * Setarea de sistem bate ceasul: "automat" insemna exclusiv "dupa ora", deci
   * un utilizator cu telefonul pe tema intunecata permanent primea tema
   * LUMINOASA la 10 dimineata — exact opusul a ce ceruse sistemului.
   */
  it('prefers the system colour scheme over the clock when the system states one', () => {
    expect(resolveTheme('auto', new Date(2026, 0, 1, 12), 'dark')).toBe('dark');
    expect(resolveTheme('auto', new Date(2026, 0, 1, 23), 'light')).toBe('light');
  });

  it('falls back to the hour range only when the system states no preference', () => {
    expect(resolveTheme('auto', new Date(2026, 0, 1, 12), 'no-preference')).toBe('light');
    expect(resolveTheme('auto', new Date(2026, 0, 1, 23), 'no-preference')).toBe('dark');
  });

  it('still ignores the system scheme for an explicit dark/light preference', () => {
    expect(resolveTheme('light', new Date(2026, 0, 1, 23), 'dark')).toBe('light');
    expect(resolveTheme('dark', new Date(2026, 0, 1, 12), 'light')).toBe('dark');
  });
});

describe('readSystemColorScheme', () => {
  it('reports no-preference when matchMedia answers false to both queries (jsdom default)', () => {
    expect(readSystemColorScheme()).toBe('no-preference');
  });

  // stubGlobal, nu spyOn: jsdom nu defineste deloc matchMedia (de aceea si codul
  // aplicatiei il gardeaza cu `typeof matchMedia !== 'function'`), deci nu exista
  // nimic pe care sa se poata spiona.
  it('reports the scheme the system actually asks for', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') }));
    expect(readSystemColorScheme()).toBe('dark');

    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('light') }));
    expect(readSystemColorScheme()).toBe('light');

    vi.unstubAllGlobals();
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

  it('for auto, applies the resolved theme to the DOM but persists "auto" itself', () => {
    applyTheme('auto', new Date(2026, 0, 1, 12));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('lumin-theme')).toBe('auto');

    applyTheme('auto', new Date(2026, 0, 1, 23));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('lumin-theme')).toBe('auto');
  });
});
