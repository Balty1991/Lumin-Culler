import { describe, it, expect, beforeEach } from 'vitest';
import { recordPersonDecision, favoritePeople } from './personTaste';

describe('personTaste', () => {
  beforeEach(() => localStorage.clear());

  it('marks people kept almost always as favourites, after enough decisions', () => {
    for (let i = 0; i < 5; i++) recordPersonDecision(['Ana'], true);
    recordPersonDecision(['Ion'], true);
    for (let i = 0; i < 4; i++) recordPersonDecision(['Vecin'], false);
    expect(favoritePeople().map(p => p.name)).toEqual(['Ana']);
  });
});
