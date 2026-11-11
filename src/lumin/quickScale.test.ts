import { describe, it, expect } from 'vitest';
import { nextQuickScale } from './Enhance';

describe('cadrul rapid al editorului', () => {
  it('scade când desenul e lent și crește la loc când e ușor', () => {
    expect(nextQuickScale(1, 30)).toBe(0.75);
    expect(nextQuickScale(1, 90)).toBe(0.56);
    expect(nextQuickScale(0.56, 5)).toBe(0.75);
    expect(nextQuickScale(0.75, 15)).toBe(0.75);
  });
  it('rămâne între trepte', () => {
    expect(nextQuickScale(0.32, 200)).toBe(0.32);
    expect(nextQuickScale(1, 2)).toBe(1);
  });
});
