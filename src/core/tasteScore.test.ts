import { describe, it, expect } from 'vitest';
import { scoreAnswer, EMPTY_SCORE } from './tasteScore';

describe('scoreAnswer', () => {
  it('counts personal and generic hits separately', () => {
    let s = scoreAnswer(EMPTY_SCORE, { personal: 'a', generic: 'b' }, 'a');
    s = scoreAnswer(s, { personal: 'b', generic: 'b' }, 'b');
    expect(s).toEqual({ hits: 2, genericHits: 1, total: 2 });
  });

  it('ignores answers without a winner and missing guesses', () => {
    expect(scoreAnswer(EMPTY_SCORE, { personal: 'a', generic: 'a' }, 'both')).toBe(EMPTY_SCORE);
    expect(scoreAnswer(EMPTY_SCORE, null, 'a')).toBe(EMPTY_SCORE);
  });
});
