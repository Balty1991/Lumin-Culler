import { describe, expect, it } from 'vitest';
import { pickMostUncertain, uncertainty, MIN_UNCERTAINTY, UNCERTAIN_BATCH, type UncertainCandidate } from './uncertainty';

function photo(id: string, aiScore: number, status: string = 'selected'): UncertainCandidate {
  return { id, aiScore, status };
}
const NONE = new Set<string>();

describe('uncertainty', () => {
  it('e maxima la aruncarea de moneda si minima la capete', () => {
    expect(uncertainty(50)).toBe(1);
    expect(uncertainty(0)).toBe(0);
    expect(uncertainty(100)).toBe(0);
  });

  it('e simetrica: un 30 e la fel de nesigur ca un 70', () => {
    expect(uncertainty(30)).toBeCloseTo(uncertainty(70));
  });

  it('scade monoton pe masura ce te departezi de 50', () => {
    expect(uncertainty(55)).toBeGreaterThan(uncertainty(70));
    expect(uncertainty(70)).toBeGreaterThan(uncertainty(90));
  });

  it('nu iese din 0..1 nici la scoruri imposibile', () => {
    expect(uncertainty(-40)).toBe(0);
    expect(uncertainty(180)).toBe(0);
  });
});

describe('pickMostUncertain', () => {
  it('propune intai pozele cele mai apropiate de limita', () => {
    const result = pickMostUncertain(
      [photo('sigur', 95), photo('la-limita', 66), photo('clar', 88), photo('aproape', 72)],
      NONE
    );
    expect(result).toEqual(['la-limita', 'aproape']);
    // 95 si 88 sunt decizii pe care motorul chiar si le asuma — nu are rost sa intrebe
    expect(result).not.toContain('sigur');
    expect(result).not.toContain('clar');
  });

  it('sare peste pozele care oricum asteapta decizia ta', () => {
    // 'review' nu are nicio decizie automata care sa poata fi gresita
    expect(pickMostUncertain([photo('r', 50, 'review'), photo('s', 51)], NONE)).toEqual(['s']);
  });

  it('nu te intreaba a doua oara despre o poza pe care ai judecat-o deja', () => {
    const candidates = [photo('deja', 50), photo('noua', 52)];
    expect(pickMostUncertain(candidates, new Set(['deja']))).toEqual(['noua']);
  });

  it('nu deranjeaza pentru poze despre care motorul chiar e sigur', () => {
    expect(pickMostUncertain([photo('a', 5), photo('b', 97)], NONE)).toEqual([]);
    // exact la prag inca intra: 75 (si simetric 25) e capatul benzii "decis la limita"
    expect(uncertainty(75)).toBeCloseTo(MIN_UNCERTAINTY);
    expect(uncertainty(25)).toBeCloseTo(MIN_UNCERTAINTY);
    expect(pickMostUncertain([photo('prag', 75)], NONE)).toEqual(['prag']);
    expect(pickMostUncertain([photo('dincolo', 76)], NONE)).toEqual([]);
  });

  it('prinde deopotriva pastrarile si respingerile luate la limita', () => {
    // simetria conteaza: teama reala e sa nu fi aruncat ceva bun, dar o
    // pastrare slaba e la fel de mult o decizie automata pusa la indoiala
    const result = pickMostUncertain([photo('respinsa-la-limita', 34, 'rejected'), photo('pastrata-la-limita', 66)], NONE);
    expect(result).toHaveLength(2);
  });

  it('se opreste la o runda scurta, nu porneste inca o sesiune de triaj', () => {
    const many = Array.from({ length: 100 }, (_, i) => photo('p' + i, 50));
    expect(pickMostUncertain(many, NONE)).toHaveLength(UNCERTAIN_BATCH);
    expect(pickMostUncertain(many, NONE, 3)).toHaveLength(3);
  });

  it('intoarce o lista goala pe o biblioteca fara nimic de verificat', () => {
    expect(pickMostUncertain([], NONE)).toEqual([]);
  });
});
