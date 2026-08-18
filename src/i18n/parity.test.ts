/**
 * i18n/parity.test.ts
 * Paritatea cheilor RO/EN e deja garantata de tipuri (en.ts e
 * `Record<TranslationKey, string>`, vezi en.ts) — o cheie adaugata doar in
 * romana e eroare de compilare, nu ceva de testat aici.
 *
 * Ce tipurile NU pot verifica, si de aceea exista fisierul asta: parametrii
 * interpolati. `t()` inlocuieste `{param}` prin cautare de text, deci o
 * traducere care scrie `{cont}` in loc de `{count}`, sau care uita parametrul
 * cu totul, nu da nicio eroare — livreaza pur si simplu un text gresit sau cu
 * acolade vizibile pe ecran.
 */
import { describe, it, expect } from 'vitest';
import { ro } from './ro';
import { en } from './en';

/** Numele parametrilor `{...}` dintr-un text, ca multime sortata. */
function params(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
}

describe('dictionarele de traducere', () => {
  it('folosesc aceiasi parametri interpolati in romana si in engleza', () => {
    const nepotriviri: string[] = [];
    for (const key of Object.keys(ro) as (keyof typeof ro)[]) {
      const roParams = params(ro[key]);
      const enParams = params(en[key]);
      if (roParams.join(',') !== enParams.join(',')) {
        nepotriviri.push(`${key}: ro={${roParams}} en={${enParams}}`);
      }
    }
    expect(nepotriviri).toEqual([]);
  });

  it('nu lasa acolade nepereche, care s-ar vedea ca atare pe ecran', () => {
    const stricate: string[] = [];
    for (const [dict, name] of [[ro, 'ro'], [en, 'en']] as const) {
      for (const [key, text] of Object.entries(dict)) {
        const deschise = (text.match(/\{/g) ?? []).length;
        const inchise = (text.match(/\}/g) ?? []).length;
        if (deschise !== inchise) stricate.push(`${name}/${key}: ${text}`);
      }
    }
    expect(stricate).toEqual([]);
  });
});
