/**
 * lumin/editRecipes.ts
 * „Dintr-o atingere”: rețete gata făcute pentru editor. Fiecare pune stilul, cât de
 * tare, câteva reglaje de mână și cadrul, toate deodată (cerut: „mulți vor totul la
 * o apăsare”). Se pot ajusta apoi ca orice editare, iar ↶ le anulează.
 */
export type RecipeStyle = 'natural' | 'vivid' | 'warm' | 'clear' | 'film' | 'bw' | 'drama' | 'portrait' | 'retouch';
export type RecipeAspect = 'orig' | 'ai' | '4:5' | '1:1' | '9:16' | '16:9';
export type RecipeKey = 'perfect' | 'insta' | 'story' | 'sunset' | 'food' | 'landscape' | 'night' | 'document' | 'retro' | 'mono';

export interface Recipe {
  key: RecipeKey;
  icon: string;
  style: RecipeStyle;
  amount: number;
  manual: Record<string, number>;
  aspect: RecipeAspect;
}

export const RECIPES: readonly Recipe[] = [
  { key: 'perfect', icon: '✨', style: 'natural', amount: 0.65, manual: { sharpen: 12, clarity: 6 }, aspect: 'ai' },
  { key: 'insta', icon: '📸', style: 'vivid', amount: 0.6, manual: { sharpen: 10, clarity: 6 }, aspect: '4:5' },
  { key: 'story', icon: '📱', style: 'vivid', amount: 0.6, manual: { sharpen: 8 }, aspect: '9:16' },
  { key: 'sunset', icon: '🌅', style: 'warm', amount: 0.8, manual: { saturation: 8, highlights: -10 }, aspect: 'orig' },
  { key: 'food', icon: '🍕', style: 'vivid', amount: 0.7, manual: { temperature: 6, sharpen: 14, clarity: 8 }, aspect: '1:1' },
  { key: 'landscape', icon: '🏞️', style: 'vivid', amount: 0.75, manual: { dehaze: 8, clarity: 10, highlights: -12 }, aspect: 'orig' },
  { key: 'night', icon: '🌙', style: 'natural', amount: 0.6, manual: { shadows: 18, highlights: -10, noiseReduction: 30 }, aspect: 'orig' },
  { key: 'document', icon: '📄', style: 'natural', amount: 0.4, manual: { contrast: 22, whites: 15, saturation: -35, sharpen: 20 }, aspect: 'orig' },
  { key: 'retro', icon: '🎞️', style: 'film', amount: 0.9, manual: { grain: 18 }, aspect: 'orig' },
  { key: 'mono', icon: '⚫', style: 'bw', amount: 1, manual: { contrast: 10 }, aspect: 'orig' }
];

/**
 * Rețeta aplicată pe o poză anume: „Perfectă” ia stilul recomandat pentru poză (dacă e),
 * iar stilurile care cer o față cad pe „Natural” când poza n-are una.
 */
export function resolveRecipe(r: Recipe, opts: { recommended?: RecipeStyle | null; hasFace: boolean; allowed: readonly string[] }): Recipe {
  let style: RecipeStyle = r.key === 'perfect' && opts.recommended ? opts.recommended : r.style;
  if (!opts.allowed.includes(style)) style = 'natural';
  const aspect: RecipeAspect = r.aspect === 'ai' && !opts.hasFace ? 'orig' : r.aspect;
  return { ...r, style, aspect };
}
