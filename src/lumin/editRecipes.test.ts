import { describe, expect, it } from 'vitest';
import { RECIPES, resolveRecipe } from './editRecipes';

const all = ['natural', 'vivid', 'warm', 'clear', 'film', 'bw', 'drama'];

describe('rețete dintr-o atingere', () => {
  it('au chei unice și reglaje în limite', () => {
    expect(new Set(RECIPES.map(r => r.key)).size).toBe(RECIPES.length);
    for (const r of RECIPES) for (const v of Object.values(r.manual)) expect(Math.abs(v)).toBeLessThanOrEqual(40);
  });
  it('„Perfectă” ia stilul recomandat, iar fără față nu strânge cadrul', () => {
    const perfect = RECIPES.find(r => r.key === 'perfect')!;
    const r = resolveRecipe(perfect, { recommended: 'vivid', hasFace: false, allowed: all });
    expect(r.style).toBe('vivid');
    expect(r.aspect).toBe('orig');
    expect(resolveRecipe(perfect, { recommended: null, hasFace: true, allowed: all }).aspect).toBe('ai');
  });
  it('un stil indisponibil cade pe Natural', () => {
    const retro = RECIPES.find(r => r.key === 'retro')!;
    expect(resolveRecipe(retro, { hasFace: false, allowed: ['natural'] }).style).toBe('natural');
  });
});
