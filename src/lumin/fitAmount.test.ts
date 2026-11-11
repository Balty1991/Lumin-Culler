import { describe, it, expect } from 'vitest';
import { pickAmount, visibleChange } from './Enhance';

describe('intensitatea de pornire a editorului', () => {
  it('rămâne la 50% când schimbarea se vede deja', () => {
    expect(pickAmount([12])).toBe(0.5);
  });
  it('urcă până se vede, cel mult 95%', () => {
    expect(pickAmount([4, 7, 12])).toBe(0.8);
    expect(pickAmount([2, 3, 4, 5])).toBe(0.95);
  });
  it('măsoară diferența medie pe pixel', () => {
    const a = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]);
    const b = new Uint8ClampedArray([16, 10, 10, 255, 20, 26, 20, 255]);
    expect(visibleChange(a, b)).toBe(2);
  });
});

import { recommendStyle } from './Enhance';
describe('stilul de pornire, după tipul pozei', () => {
  it('peisajele, mâncarea și cerul înnorat pornesc pe „Vie”', () => {
    expect(recommendStyle(['landscape'])).toBe('vivid');
    expect(recommendStyle(['food', 'indoor'])).toBe('vivid');
  });
  it('cu oameni sau noaptea rămâne „Natural”', () => {
    expect(recommendStyle(['landscape', 'portrait'])).toBe('natural');
    expect(recommendStyle(['night', 'overcast'])).toBe('natural');
    expect(recommendStyle([])).toBe('natural');
  });
});
