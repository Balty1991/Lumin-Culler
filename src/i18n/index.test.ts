import { beforeEach, describe, expect, it } from 'vitest';
import { t, plural, necesitaDe, readStoredLocale, writeStoredLocale } from './index';
import { ro } from './ro';
import { en } from './en';

beforeEach(() => localStorage.clear());

describe('t', () => {
  it('translates a known key in each locale', () => {
    expect(t('ro', 'menu.title')).toBe('Meniu');
    expect(t('en', 'menu.title')).toBe('Menu');
  });

  it('interpolates {param} placeholders', () => {
    expect(t('ro', 'menu.gridDensity', { density: 'Mare' })).toBe('Densitatea grilei: Mare');
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

  // Cealalta directie: o cheie ramasa doar in en.ts e o traducere care nu se va
  // afisa NICIODATA (ro e limba de baza si de rezerva), deci e cod mort care
  // arata ca lucru facut. Prinsa la audit, cu ocazia curatarii pragului fantoma
  // de "nivel gratuit" — stergerea unei chei din ro.ts o lasa orfana in en.ts.
  it('ro.ts defineste fiecare cheie din en.ts (fara traduceri orfane)', () => {
    const orphans = Object.keys(en).filter(k => !(k in ro));
    expect(orphans).toEqual([]);
  });

  /**
   * Bug real de traducere, si greu de vazut cu ochiul: daca textul romanesc
   * spune "{count} din {limit}" iar cel englezesc uita `{limit}`, aplicatia nu
   * arunca nimic — doar afiseaza o propozitie ciunta, si numai pe engleza. Un
   * test care compara MULTIMEA de {parametri} per cheie prinde asta la commit,
   * nu la raportul unui utilizator.
   */
  it('fiecare cheie foloseste aceiasi {parametri} in ambele limbi', () => {
    // `countDe` se numara drept `count`: nu e un parametru trimis de apelant,
    // ci unul fabricat de t() din `count` — numarul plus "de", cand gramatica
    // romaneasca o cere (vezi i18n/index.ts). Romana scrie `{countDe}` acolo
    // unde dupa numar urmeaza un substantiv, engleza scrie `{count}`, si
    // amandoua sunt satisfacute de acelasi apel.
    const params = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map(m => (m[1] === 'countDe' ? 'count' : m[1])).sort();
    const mismatched = Object.keys(ro)
      .filter(k => k in en)
      .filter(k => params(ro[k as keyof typeof ro]).join(',') !== params(en[k as keyof typeof en]).join(','))
      .map(k => `${k}: ro=[${params(ro[k as keyof typeof ro])}] en=[${params(en[k as keyof typeof en])}]`);
    expect(mismatched).toEqual([]);
  });
});

/**
 * Particula "de" din romana: "2 poze", dar "20 de poze".
 *
 * Regula NU e "peste 20" — conteaza ultimele doua cifre, si de aceea 101
 * ramane "101 poze" iar 120 devine "120 de poze". Sunt clasele "few" si
 * "other" din CLDR pentru romana; testele de mai jos verifica exact granitele
 * unde o implementare naiva ("n >= 20") ar da gresit.
 */
describe('particula "de" (romana)', () => {
  it('nu se pune la 0 si la 1', () => {
    expect(necesitaDe(0)).toBe(false);
    expect(necesitaDe(1)).toBe(false);
  });

  it('nu se pune de la 2 la 19', () => {
    for (let n = 2; n <= 19; n++) expect(necesitaDe(n)).toBe(false);
  });

  it('se pune de la 20 in sus', () => {
    for (const n of [20, 21, 50, 99, 100]) expect(necesitaDe(n)).toBe(true);
  });

  it('se uita la ULTIMELE DOUA cifre, nu la marimea numarului', () => {
    // Capcana clasica: "n >= 20" ar pune "de" si aici, gresit.
    expect(necesitaDe(101)).toBe(false); // "101 poze"
    expect(necesitaDe(119)).toBe(false); // "119 poze"
    expect(necesitaDe(120)).toBe(true);  // "120 de poze"
    expect(necesitaDe(1001)).toBe(false); // "1001 poze"
    expect(necesitaDe(1000)).toBe(true);  // "1000 de poze"
  });

  it('t() pune "de" in romana, si nimic in engleza', () => {
    expect(t('ro', 'locations.photos.other', { count: 20 })).toBe('20 de poze');
    expect(t('ro', 'locations.photos.other', { count: 3 })).toBe('3 poze');
    expect(t('en', 'locations.photos.other', { count: 20 })).toBe('20 photos');
  });

  it('nu strica textele care nu primesc un numar', () => {
    expect(t('ro', 'locations.photos.one', { count: 1 })).toBe('1 poză');
  });

  it('nu atinge {count} acolo unde dupa numar NU urmeaza un substantiv', () => {
    // "Ai scos 20 din 100 de poze" — "de" e deja in text, dupa {limit}.
    expect(t('ro', 'premium.usage.title', { count: 20, limit: 100 }))
      .toBe('Ai scos 20 din 100 de poze în ultimele 30 de zile');
  });
});
