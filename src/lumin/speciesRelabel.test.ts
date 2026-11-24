import { describe, it, expect } from 'vitest';
import { mergeSpecies } from './speciesRelabel';

describe('mergeSpecies', () => {
  it('scoate câinele vechi când etichetarea nouă nu-l mai vede', () => {
    expect(mergeSpecies(['Toy', 'Balloon', 'Dog', 'Party'], ['Toy', 'Balloon'])).toEqual(['Toy', 'Balloon', 'Party']);
  });
  it('păstrează pisica sigură', () => {
    expect(mergeSpecies(['Skin', 'Cat', 'Dog', 'Pet'], ['Cat', 'Pet'])).toEqual(['Skin', 'Pet', 'Cat']);
  });
});
