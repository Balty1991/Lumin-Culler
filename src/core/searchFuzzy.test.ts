/**
 * core/searchFuzzy.test.ts
 *
 * Testul care conteaza aici nu e "gaseste ce trebuie" — e "NU gaseste ce nu
 * trebuie". O cautare care raspunde cu altceva decat ai cerut e mai rea decat
 * una care nu raspunde deloc, si e exact riscul unei potriviri aproximative.
 */
import { describe, it, expect } from 'vitest';
import { oSinguraGreseala, cuvinteDinText, seGasesteAproape } from './searchFuzzy';

describe('oSinguraGreseala', () => {
  it('accepta cuvinte identice', () => {
    expect(oSinguraGreseala('nunta', 'nunta')).toBe(true);
  });

  it('accepta o litera schimbata', () => {
    expect(oSinguraGreseala('nunta', 'nunla')).toBe(true);
  });

  it('accepta o litera lipsa sau in plus', () => {
    expect(oSinguraGreseala('copii', 'copiii')).toBe(true);
    expect(oSinguraGreseala('portret', 'portre')).toBe(true);
  });

  it('accepta doua litere vecine inversate — greseala clasica de tastatura', () => {
    expect(oSinguraGreseala('nunta', 'nunat')).toBe(true);
    expect(oSinguraGreseala('portret', 'protret')).toBe(true);
  });

  it('prinde formele de plural care difera printr-o litera', () => {
    expect(oSinguraGreseala('copii', 'copil')).toBe(true);
    expect(oSinguraGreseala('munti', 'munte')).toBe(true);
  });

  it('RESPINGE cuvinte la doua greseli distanta', () => {
    expect(oSinguraGreseala('nunta', 'nunfe')).toBe(false);
    expect(oSinguraGreseala('flori', 'floare')).toBe(false);
  });

  it('RESPINGE cuvinte de lungimi prea diferite, fara sa le compare', () => {
    expect(oSinguraGreseala('mare', 'marinar')).toBe(false);
  });

  it('nu confunda cuvinte scurte care chiar sunt diferite', () => {
    expect(oSinguraGreseala('casa', 'cana')).toBe(true); // o litera — de aceea exista pragul de lungime
    expect(seGasesteAproape('casa', new Set(['cana']))).toBe(false); // sub 5 litere: nici nu se incearca
  });
});

describe('cuvinteDinText', () => {
  it('taie pe orice nu e litera sau cifra', () => {
    expect(cuvinteDinText('img_2026-07 nunta.jpg')).toEqual(new Set(['2026', 'nunta']));
  });

  it('nu pastreaza cuvintele prea scurte ca sa fie vreodata comparate', () => {
    expect(cuvinteDinText('la si pe')).toEqual(new Set());
  });
});

describe('seGasesteAproape', () => {
  const cuvinte = new Set(['nunta', 'portret', 'copil', 'bucuresti']);

  it('gaseste cuvantul scris gresit', () => {
    expect(seGasesteAproape('nunat', cuvinte)).toBe(true);
    expect(seGasesteAproape('protret', cuvinte)).toBe(true);
  });

  it('gaseste cealalta forma a cuvantului', () => {
    expect(seGasesteAproape('copii', cuvinte)).toBe(true);
  });

  it('nu se declanseaza sub pragul de lungime', () => {
    expect(seGasesteAproape('nunt', cuvinte)).toBe(false);
  });

  it('nu inventeaza potriviri', () => {
    expect(seGasesteAproape('schior', cuvinte)).toBe(false);
    expect(seGasesteAproape('timisoara', cuvinte)).toBe(false);
  });
});
