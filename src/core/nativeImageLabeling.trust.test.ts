import { describe, it, expect } from 'vitest';
import { trustedLabels } from './nativeImageLabeling';

const L = (label: string, score: number) => ({ label, score });
describe('trustedLabels', () => {
  it('scoate câinele nesigur de la o poză cu baloane', () => {
    expect(trustedLabels([L('Toy', 0.9), L('Balloon', 0.8), L('Dog', 0.66)]).map(l => l.label)).toEqual(['Toy', 'Balloon']);
  });
  it('câine și pisică apropiate: nicio specie, rămâne Pet (raportat: fetița cu pisica)', () => {
    expect(trustedLabels([L('Dog', 0.85), L('Cat', 0.72), L('Pet', 0.9)]).map(l => l.label)).toEqual(['Pet']);
  });
  it('pisică clară, câine slab: rămâne pisica', () => {
    expect(trustedLabels([L('Cat', 0.93), L('Dog', 0.65), L('Pet', 0.9)]).map(l => l.label)).toEqual(['Cat', 'Pet']);
  });
  it('păstrează câinele sigur', () => {
    expect(trustedLabels([L('Dog', 0.96), L('Grass', 0.7)]).map(l => l.label)).toEqual(['Dog', 'Grass']);
  });
});

describe('trustedLabels — pragul 0,9', () => {
  it('câinele de 0,85 la fetița cu pisica nu mai trece (raportat)', () => {
    expect(trustedLabels([{ label: 'Pet', score: 0.9 }, { label: 'Dog', score: 0.86 }]).map(l => l.label)).toEqual(['Pet']);
  });
});
