import { describe, it, expect } from 'vitest';
import { fitFactors } from './ScoreReason';

const f = (label: string) => ({ label, positive: true });

describe('cate motive incap pe linia de decizie', () => {
  it('doua motive scurte incap amandoua', () => {
    expect(fitFactors([f('Clar'), f('Oră de aur')]).map(x => x.label)).toEqual(['Clar', 'Oră de aur']);
  });

  it('un motiv lung il exclude pe al doilea, in loc sa-l taie', () => {
    // cazul real din captura de pe telefon: al doilea motiv se ciuntea si
    // ramanea doar bulina lui colorata pe ecran
    const r = fitFactors([f('Fără date de aparat foto'), f('Claritate')]);
    expect(r.map(x => x.label)).toEqual(['Fără date de aparat foto']);
  });

  it('primul motiv intra intotdeauna, oricat de lung ar fi', () => {
    const lung = f('Un motiv absurd de lung care nu incape nicaieri pe un telefon');
    expect(fitFactors([lung, f('Clar')]).map(x => x.label)).toEqual([lung.label]);
  });

  it('cel mult doua, chiar daca ar incapea mai multe', () => {
    expect(fitFactors([f('A'), f('B'), f('C'), f('D')])).toHaveLength(2);
  });

  it('fara motive, lista ramane goala', () => {
    expect(fitFactors([])).toEqual([]);
  });

  it('bugetul e reglabil si chiar e respectat', () => {
    expect(fitFactors([f('12345'), f('12345')], 8)).toHaveLength(1);
    expect(fitFactors([f('12345'), f('12345')], 12)).toHaveLength(2);
  });
});
