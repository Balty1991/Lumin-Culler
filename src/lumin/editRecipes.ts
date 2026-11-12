/**
 * lumin/editRecipes.ts
 * „Dintr-o atingere”: rețete gata făcute pentru editor. Fiecare pune stilul, cât de
 * tare, câteva reglaje de mână și cadrul, toate deodată (cerut: „mulți vor totul la
 * o apăsare”). Se pot ajusta apoi ca orice editare, iar ↶ le anulează.
 */
export type RecipeStyle = 'natural' | 'vivid' | 'warm' | 'clear' | 'film' | 'bw' | 'drama' | 'portrait' | 'retouch';
export type RecipeAspect = 'orig' | 'ai' | '4:5' | '1:1' | '9:16' | '16:9';
export type RecipeKey = 'perfect' | 'insta' | 'facebook' | 'tiktok' | 'story' | 'sunset' | 'food' | 'landscape' | 'night' | 'document' | 'retro' | 'mono';

export interface Recipe {
  key: RecipeKey;
  icon: string;
  style: RecipeStyle;
  amount: number;
  manual: Record<string, number>;
  aspect: RecipeAspect;
}

export const RECIPES: readonly Recipe[] = [
  // „Perfectă”: nu Natural cu două reglaje (raportat: „să nu aibă treabă cu Natural, să fie wow”).
  // Culori vii, lumină pe fețe, umbrele deschise, luminile ținute, detaliu și cadru pe subiect.
  // Fără saturație și contrast în plus: pe pozele deja colorate ardeau roșul (raportat cu capturi).
  // Fără decupaj (o poză tăiată nu e ce aștepți de la „Perfectă”) și fără claritate locală
  // (lăsa un contur luminos în jurul omului) — raportat cu capturi.
  { key: 'perfect', icon: '✨', style: 'vivid', amount: 0.5, manual: { relight: 10, shadows: 8, highlights: -10, sharpen: 8 }, aspect: 'orig' },
  { key: 'insta', icon: '📸', style: 'vivid', amount: 0.6, manual: { sharpen: 10, clarity: 6 }, aspect: '4:5' },
  { key: 'facebook', icon: '👍', style: 'vivid', amount: 0.45, manual: { shadows: 8, sharpen: 8 }, aspect: '4:5' },
  { key: 'tiktok', icon: '🎵', style: 'vivid', amount: 0.7, manual: { contrast: 10, saturation: 10, clarity: 8, sharpen: 12 }, aspect: '9:16' },
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
  // „Perfectă” ia stilul recomandat pentru poză doar dacă e mai mult decât Natural.
  let style: RecipeStyle = r.key === 'perfect' && opts.recommended && opts.recommended !== 'natural' ? opts.recommended : r.style;
  if (!opts.allowed.includes(style)) style = 'natural';
  const aspect: RecipeAspect = r.aspect === 'ai' && !opts.hasFace ? 'orig' : r.aspect;
  // Lumina pe fețe, doar unde sunt fețe.
  const manual = opts.hasFace ? r.manual : Object.fromEntries(Object.entries(r.manual).filter(([k]) => k !== 'relight'));
  return { ...r, style, aspect, manual };
}

/** Treptele încercate pentru o rețetă pe o poză anume (din plin, apoi tot mai blând). */
export const RECIPE_STEPS = [1, 0.75, 0.55, 0.4];
/** Cât poate schimba o rețetă poza (diferența medie pe pixel) și cât din poză poate „arde”. */
export const RECIPE_MAX_CHANGE = 16;
export const RECIPE_MAX_CLIP = 0.015;

/** Rețeta la intensitatea `k`: stilul și reglajele de mână, toate scalate. */
export function scaleRecipe(r: Recipe, k: number, saturated: boolean): Recipe {
  const manual: Record<string, number> = {};
  for (const [key, v] of Object.entries(r.manual)) {
    // Pe o poză deja foarte colorată, culoarea nu mai urcă.
    if (saturated && (key === 'saturation' || key === 'contrast') && v > 0) continue;
    manual[key] = Math.round(v * k);
  }
  return { ...r, amount: Math.round(r.amount * k * 100) / 100, manual };
}

/** Prima treaptă care rămâne sub ambele praguri; cea mai blândă dacă niciuna. */
export function pickRecipeStep(results: readonly { change: number; clip: number }[], steps: readonly number[] = RECIPE_STEPS): number {
  const i = results.findIndex(x => x.change <= RECIPE_MAX_CHANGE && x.clip <= RECIPE_MAX_CLIP);
  return steps[i < 0 ? Math.min(results.length, steps.length) - 1 : i];
}
