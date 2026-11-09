import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ă â î ș ț trebuie să aibă glife în fonturile încărcate la pornire.
 * â și î sunt în Latin-1. ă (U+0103), ș (U+0219) și ț (U+021B) sunt în
 * intervalul latin-ext U+0100–U+02BA, prezent și la Sora, și la Inter.
 */
function covers(css: string): boolean {
  return css.includes('U+0000-00FF') && css.includes('U+0100-02BA');
}

describe('diacritice românești în fonturile locale', () => {
  it('Sora, Inter și JetBrains Mono declară Latin-1 și latin-ext', () => {
    const root = resolve(__dirname, '../../node_modules/@fontsource-variable');
    for (const name of ['sora', 'inter', 'jetbrains-mono']) {
      const css = readFileSync(resolve(root, name, 'index.css'), 'utf8');
      expect(covers(css), name).toBe(true);
    }
  });

  it('scara de tip din sistemul vizual există și nu aduce un font nou', () => {
    const css = readFileSync(resolve(__dirname, 'system.css'), 'utf8');
    expect(css).toMatch(/--fs-display:\s*2\.15rem/);
    expect(css).toMatch(/Sora Variable/);
    expect(css).toMatch(/Inter Variable/);
    expect(css).not.toMatch(/fonts\.google|cdn/);
  });
});
