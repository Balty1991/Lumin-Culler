import { describe, expect, it } from 'vitest';
import { findCounterfactual } from './scoreCounterfactual';

const praguri = { select: 65, reject: 35 };

describe('ce a tinut poza pe loc', () => {
  it('gaseste factorul fara de care ar fi trecut de "pastreaza"', () => {
    const r = findCounterfactual(58, [
      { feature: 'noCameraMetadata', contribution: -0.9 },
      { feature: 'sharpness', contribution: 1.2 }
    ], praguri);
    expect(r?.feature).toBe('noCameraMetadata');
    expect(r?.verdict).toBe('selected');
    expect(r?.score).toBeGreaterThanOrEqual(65);
  });

  it('nu cauta nimic la o poza care oricum a trecut', () => {
    expect(findCounterfactual(80, [{ feature: 'x', contribution: -2 }], praguri)).toBe(null);
  });

  it('alege "cat pe ce", nu "cel mai greu" — la asta raspund deja factorii afisati', () => {
    const r = findCounterfactual(60, [
      { feature: 'mic', contribution: -0.4 },
      { feature: 'urias', contribution: -3 }
    ], praguri);
    // ambii ar fi rasturnat verdictul; il vrem pe cel mai mic
    expect(r?.feature).toBe('mic');
  });

  it('factorii care ajuta nu pot fi de vina', () => {
    expect(findCounterfactual(50, [{ feature: 'bun', contribution: 2 }], praguri)).toBe(null);
  });

  it('nu inventeaza un contrafactual cand niciun factor n-ar fi ajuns', () => {
    expect(findCounterfactual(20, [{ feature: 'firav', contribution: -0.05 }], praguri)).toBe(null);
  });

  it('la o poza respinsa spune ce ar fi scapat-o de cos', () => {
    const r = findCounterfactual(28, [{ feature: 'blur', contribution: -0.6 }], praguri);
    expect(r?.verdict).toBe('rejected');
    expect(r?.score).toBeGreaterThan(35);
  });

  it('fara factori nu are ce spune', () => {
    expect(findCounterfactual(50, [], praguri)).toBe(null);
    expect(findCounterfactual(50, undefined, praguri)).toBe(null);
  });

  it('nu se sufoca la contributii corupte', () => {
    const r = findCounterfactual(50, [
      { feature: 'nan', contribution: NaN },
      { feature: 'inf', contribution: -Infinity },
      { feature: 'bun', contribution: -0.8 }
    ], praguri);
    expect(r?.feature).toBe('bun');
  });
});
