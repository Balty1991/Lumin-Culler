import { describe, it, expect } from 'vitest';
import { relatedSceneTags, SYNONYM_KEYS } from './searchSynonyms';

describe('relatedSceneTags', () => {
  it('cazul raportat: "zapada" ajunge la etichetele pe care le emite chiar modelul', () => {
    const tags = relatedSceneTags('zapada');
    expect(tags.has('snow')).toBe(true);
    // pozele utilizatorului fusesera etichetate "ice", nu "snow" — de asta cautarea dadea 0
    expect(tags.has('ice')).toBe(true);
    expect(tags.has('winter')).toBe(true);
  });

  it('merge si pe prefix, ca rezultatele apara in timp ce tastezi', () => {
    expect(relatedSceneTags('zapa').has('snow')).toBe(true);
    expect(relatedSceneTags('zapadaaa').has('snow')).toBe(true);
  });

  it('nu porneste pe fragmente prea scurte — ar aduce tot', () => {
    expect(relatedSceneTags('za').size).toBe(0);
    expect(relatedSceneTags('').size).toBe(0);
  });

  it('nu inventeaza nimic pentru un cuvant necunoscut', () => {
    expect(relatedSceneTags('qwerty').size).toBe(0);
    expect(relatedSceneTags('xyzabc').size).toBe(0);
  });

  it('o cautare mai lunga care incepe cu un cuvant stiut tot functioneaza', () => {
    // "bicicleta rosie" e tot despre biciclete — nu avem motiv sa ne prefacem ca nu stim
    expect(relatedSceneTags('bicicleta rosie').has('bicycle')).toBe(true);
  });

  it('acopera si engleza, nu doar romana', () => {
    expect(relatedSceneTags('snow').has('ice')).toBe(true);
    expect(relatedSceneTags('food').has('cake')).toBe(true);
  });

  it('un cuvant general aduce mai multe etichete concrete', () => {
    expect(relatedSceneTags('animal').size).toBeGreaterThan(4);
    expect(relatedSceneTags('caine')).toEqual(new Set(['dog']));
  });

  it('toate cheile sunt deja normalizate (fara diacritice, litere mici)', () => {
    for (const k of SYNONYM_KEYS) {
      expect(k).toBe(k.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    }
  });

  it('nicio cheie nu trimite spre o lista goala', () => {
    for (const k of SYNONYM_KEYS) expect(relatedSceneTags(k).size).toBeGreaterThan(0);
  });
});
