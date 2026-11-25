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

import { lacksMlkitLabels } from './speciesRelabel';
describe('lacksMlkitLabels', () => {
  it('pozele din 3.6.1 fără etichete ML Kit (doar chei CLIP sau nimic)', () => {
    expect(lacksMlkitLabels(undefined)).toBe(true);
    expect(lacksMlkitLabels(['cat', 'child'])).toBe(true);
    expect(lacksMlkitLabels(['Person', 'Smile', 'cat'])).toBe(false);
  });
});
