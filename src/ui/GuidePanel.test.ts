import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ro } from '../i18n/ro';
import { en } from '../i18n/en';

const guide = readFileSync('src/ui/GuidePanel.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

/** Sectiunile si numarul lor de paragrafe, citite chiar din componenta. */
function sections(): { key: string; paragraphs: number }[] {
  const list = guide.match(/const SECTIONS = \[([\s\S]*?)\] as const;/)![1];
  const keys = [...list.matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  const counts = guide.match(/const PARAGRAPHS[^=]*= \{([\s\S]*?)\};/)![1];
  return keys.map(key => {
    const m = counts.match(new RegExp(`${key}:\\s*(\\d+)`));
    return { key, paragraphs: Number(m![1]) };
  });
}

describe('manualul aplicatiei', () => {
  it('fiecare sectiune are titlu si toate paragrafele, in ambele limbi', () => {
    for (const { key, paragraphs } of sections()) {
      for (const [name, dict] of [['ro', ro], ['en', en]] as const) {
        expect(dict[`guide.${key}.title` as keyof typeof dict], `${name}: guide.${key}.title`).toBeTruthy();
        for (let i = 1; i <= paragraphs; i++) {
          const k = `guide.${key}.p${i}` as keyof typeof dict;
          expect(dict[k], `${name}: guide.${key}.p${i}`).toBeTruthy();
        }
      }
    }
  });

  it('nu exista paragrafe scrise degeaba, pe care componenta nu le arata', () => {
    // O cheie guide.<sectiune>.pN peste numarul declarat n-ar aparea niciodata
    // pe ecran, si nimeni n-ar observa ca lipseste din interfata.
    const declared = new Set(
      sections().flatMap(({ key, paragraphs }) =>
        Array.from({ length: paragraphs }, (_, i) => `guide.${key}.p${i + 1}`))
    );
    const written = Object.keys(ro).filter(k => /^guide\.[a-z]+\.p\d+$/.test(k));
    expect(written.filter(k => !declared.has(k))).toEqual([]);
  });

  it('panoul e montat in AMBELE ramuri de randare ale aplicatiei', () => {
    // Bug real: App.tsx are doua ramuri (ecranul de bun venit si aplicatia cu
    // poze), fiecare cu propriul set de panouri. Montat intr-una singura,
    // manualul se deschidea din meniu... si nu aparea nimic.
    const montari = (app.match(/<GuidePanel \/>/g) ?? []).length;
    const referinta = (app.match(/<MenuDrawer \/>/g) ?? []).length;
    expect(montari).toBe(referinta);
  });
});
