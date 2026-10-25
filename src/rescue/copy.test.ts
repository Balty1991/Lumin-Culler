import { describe, expect, it } from 'vitest';
import { rescueCopy, rescueT } from './copy';

function params(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map(match => (match[1] === 'countDe' ? 'count' : match[1])).sort();
}

describe('cleaner copy', () => {
  it('keeps Romanian and English on the same keys and parameters', () => {
    const roKeys = Object.keys(rescueCopy.ro).sort();
    const enKeys = Object.keys(rescueCopy.en).sort();
    expect(enKeys).toEqual(roKeys);
    const mismatches: string[] = [];
    for (const key of roKeys as (keyof typeof rescueCopy.ro)[]) {
      const roParams = params(rescueCopy.ro[key]);
      const enParams = params(rescueCopy.en[key]);
      if (roParams.join(',') !== enParams.join(',')) mismatches.push(`${key}: ro={${roParams}} en={${enParams}}`);
      const braces = (rescueCopy.ro[key].match(/\{/g) ?? []).length;
      const closed = (rescueCopy.ro[key].match(/\}/g) ?? []).length;
      if (braces !== closed) mismatches.push(`ro/${key} unbalanced`);
    }
    expect(mismatches).toEqual([]);
  });

  it('adds the Romanian de particle only when the number needs it', () => {
    expect(rescueT('ro', 'pileMeta', { size: '2 MB', count: 2 })).toBe('2 MB · 2 fișiere');
    expect(rescueT('ro', 'pileMeta', { size: '2 MB', count: 20 })).toBe('2 MB · 20 de fișiere');
    expect(rescueT('en', 'pileMeta', { size: '2 MB', count: 20 })).toBe('2 MB · 20 files');
  });
});
