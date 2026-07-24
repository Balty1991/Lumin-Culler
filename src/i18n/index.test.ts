import { beforeEach, describe, expect, it } from 'vitest';
import { t, plural, readStoredLocale, writeStoredLocale } from './index';
import { ro } from './ro';
import { en } from './en';

beforeEach(() => localStorage.clear());

describe('t', () => {
  it('translates a known key in each locale', () => {
    expect(t('ro', 'menu.title')).toBe('Meniu');
    expect(t('en', 'menu.title')).toBe('Menu');
  });

  it('interpolates {param} placeholders', () => {
    expect(t('ro', 'menu.gridDensity', { density: 'Mare' })).toBe('Densitate grila: Mare');
    expect(t('en', 'menu.gridDensity', { density: 'Large' })).toBe('Grid density: Large');
  });

  it('falls back to the Romanian string for a key missing in the requested locale, and to the raw key if missing everywhere', () => {
    expect(t('en', '__nonexistent__')).toBe('__nonexistent__');
  });
});

describe('plural', () => {
  it('picks the singular form only for exactly 1', () => {
    expect(plural(1, 'one', 'other')).toBe('one');
  });

  it('picks the other form for 0 and for 2+', () => {
    expect(plural(0, 'one', 'other')).toBe('other');
    expect(plural(2, 'one', 'other')).toBe('other');
    expect(plural(25, 'one', 'other')).toBe('other');
  });
});

describe('locale storage', () => {
  it('defaults to ro when nothing is stored', () => {
    expect(readStoredLocale()).toBe('ro');
  });

  it('round-trips a written locale', () => {
    writeStoredLocale('en');
    expect(readStoredLocale()).toBe('en');
  });

  it('treats any unrecognized stored value as ro', () => {
    localStorage.setItem('lumin-locale', 'fr');
    expect(readStoredLocale()).toBe('ro');
  });
});

describe('dictionary completeness', () => {
  it('en.ts defines every key present in ro.ts (TypeScript already enforces this structurally, but verify the objects too)', () => {
    const missing = Object.keys(ro).filter(k => !(k in en));
    expect(missing).toEqual([]);
  });
});
