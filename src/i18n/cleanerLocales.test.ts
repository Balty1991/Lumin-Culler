import { describe, expect, it } from 'vitest';
import { ro } from './ro';
import { en } from './en';
import { ptBR } from './pt-BR';
import { es } from './es';
import { de } from './de';

/** `{countDe}` e același parametru cu `{count}`, doar cu particula românească. */
function params(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map(match => (match[1] === 'countDe' ? 'count' : match[1])).sort();
}

describe('limbile cleaner-ului', () => {
  const locales = { 'pt-BR': ptBR, es, de } as const;

  it('acoperă aceleași chei noi și aceiași parametri ca engleza', () => {
    for (const [name, dict] of Object.entries(locales)) {
      for (const [key, text] of Object.entries(dict)) {
        const reference = (en as Record<string, string>)[key] || (ro as Record<string, string>)[key];
        expect(reference, `${name} ${key}`).toBeTruthy();
        expect(params(text), `${name} ${key}`).toEqual(params(reference));
      }
    }
  });
});
