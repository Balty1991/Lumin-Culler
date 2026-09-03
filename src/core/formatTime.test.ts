import { describe, expect, it } from 'vitest';
import { formatEta, formatSpan } from './formatTime';

/**
 * core/formatTime.test.ts
 * Doua formatari, cu doua treburi diferite — si testele exista ca sa nu se
 * amestece la loc.
 */
describe('formatEta (estimare care se scurge sub ochii tai)', () => {
  it('sub un minut ramane in secunde', () => {
    expect(formatEta(45)).toBe('45s');
  });

  it('nu scrie niciodata "0s" pentru ceva ce inca nu s-a terminat', () => {
    // O bara care mai are de lucru, dar anunta zero, arata ca s-a blocat.
    expect(formatEta(0)).toBe('1s');
    expect(formatEta(0.2)).toBe('1s');
  });

  it('peste un minut arata si minutele, si secundele', () => {
    expect(formatEta(90)).toBe('1m 30s');
  });
});

describe('formatSpan (durata cumulata, citita dintr-o privire)', () => {
  it('sub un minut ramane in secunde', () => {
    expect(formatSpan(45)).toBe('45 s');
  });

  it('peste un minut renunta la secunde', () => {
    // Intr-un total de-o viata, secundele sunt zgomot: nimeni nu citeste
    // "18 min 37 s" altfel decat "vreo 18 minute".
    expect(formatSpan(1117)).toBe('19 min');
  });

  it('peste o ora trece la ore — motivul pentru care exista functia asta', () => {
    // `formatEta` ar fi scris "700m 0s" pentru acelasi numar. Nu e gresit, dar
    // nimeni nu-l citeste ca pe unsprezece ore si jumatate.
    expect(formatSpan(42_000)).toBe('11 h 40 min');
  });

  it('la fix nu mai adauga "0 min"', () => {
    expect(formatSpan(7200)).toBe('2 h');
  });

  it('zero e zero, nu se rotunjeste in sus', () => {
    // Aici, spre deosebire de ETA, zero chiar inseamna "nimic inca" — si nu se
    // afiseaza oricum, fiindca blocul care il foloseste tace fara date.
    expect(formatSpan(0)).toBe('0 s');
  });
});
