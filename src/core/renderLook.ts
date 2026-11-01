/**
 * Aceiași pași ca editorul, pe un buffer, ca testele și grila de probe
 * să arate ce vede omul pe telefon.
 */
import { applySubjectFinish, applySliderGrade, measureFrame, recipeFromStats, recipeToAdjustments, type LookFace, type LookRecipe } from './autoLook';
import { applyDehaze, applyDetailPass, applySky, type EditAdjustments } from './imageAdjust';

export function renderLook(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  faces: readonly LookFace[] = []
): { data: Uint8ClampedArray; recipe: LookRecipe } {
  const stats = measureFrame(src, width, height, faces, width > 220 ? 2 : 1);
  const recipe = recipeFromStats(stats, faces);
  const data = new Uint8ClampedArray(src);
  const adj = recipeToAdjustments(recipe) as unknown as EditAdjustments;
  applySliderGrade(data, adj);
  if ((adj.noiseReduction ?? 0) || (adj.clarity ?? 0) || (adj.sharpen ?? 0) || (adj.toneMap ?? 0)) {
    applyDetailPass(data, width, height, adj);
  }
  if (adj.dehaze) applyDehaze(data, width, height, adj.dehaze);
  if (adj.sky) applySky(data, width, height, adj.sky);
  applySubjectFinish(data, width, height, recipe.relight, recipe.redEye, faces);
  return { data, recipe };
}
