import { describe, it, expect } from 'vitest';
import { trustedLabels } from './nativeImageLabeling';

const L = (label: string, score: number) => ({ label, score });
describe('trustedLabels', () => {
  it('scoate câinele nesigur de la o poză cu baloane', () => {
    expect(trustedLabels([L('Toy', 0.9), L('Balloon', 0.8), L('Dog', 0.66)]).map(l => l.label)).toEqual(['Toy', 'Balloon']);
  });
  it('la pisică și câine o păstrează pe cea mai probabilă', () => {
    expect(trustedLabels([L('Cat', 0.88), L('Dog', 0.82), L('Pet', 0.9)]).map(l => l.label)).toEqual(['Cat', 'Pet']);
  });
  it('păstrează câinele sigur', () => {
    expect(trustedLabels([L('Dog', 0.95), L('Grass', 0.7)]).map(l => l.label)).toEqual(['Dog', 'Grass']);
  });
});
