/**
 * lumin/coverable.ts
 * Poate fi poza aceasta o copertă (imaginea mare de pe „Azi”, coperta unei povești)?
 * Nu dacă pare captură de ecran, document sau meme, chiar nemarcată ca atare la import
 * (raportat cu înregistrare: o captură din aplicația veche, cu o față pe ea, era coperta
 * cardului „58 de poze de văzut”, iar textul ei se suprapunea peste al aplicației).
 */
const SCREEN_NAME = /^(screenshot|screen_shot|screnshot|captura|capture_|scrn|screenrecord|screen_record)/i;
const SCREEN_TAGS = /^(screenshot|document|meme|receipt|text)$/i;
const TEXT_HEAVY = 0.08;

export interface CoverInput { aside?: unknown; fileName?: string; sceneTags?: string[]; textCoverage?: number }

export function coverable(p: CoverInput): boolean {
  if (p.aside) return false;
  const base = (p.fileName ?? '').split(/[\\/]/).pop() ?? '';
  if (SCREEN_NAME.test(base)) return false;
  if (p.sceneTags?.some(t => SCREEN_TAGS.test(t))) return false;
  if ((p.textCoverage ?? 0) >= TEXT_HEAVY) return false;
  return true;
}
