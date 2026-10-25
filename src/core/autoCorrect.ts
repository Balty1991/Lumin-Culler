/**
 * Corectarea automată a cadrelor PĂSTRATE.
 *
 * Coada de salvare (rescueQueue) sare peste pozele deja selectate: acolo
 * întrebarea e „se poate salva un cadru respins?”. Aici întrebarea e alta:
 * cadrul ales din serie rămâne, și i se aplică aceleași reparații, pe o copie.
 *
 * Fișierul din galerie nu se atinge. Ajustările sunt aceleași funcții din
 * editor (imageAdjust), nu o rețetă nouă.
 */
import type { PhotoStatus } from './db';
import { fixesFor, type RescueFix } from './rescueQueue';
import {
  computeAutoCrop, computeAutoExposureFromScore, computeAutoHighlightsShadows,
  NEUTRAL_ADJUSTMENTS, type EditAdjustments
} from './imageAdjust';

/** Câte copii corectate intră în mostra gratuită. Restul e Premium. */
export const FREE_AUTO_CORRECT_PHOTOS = 3;

const MAX_ROTATION_DEG = 8;

export interface CorrectablePhoto {
  id: string;
  status: PhotoStatus;
  aiScore: number;
  sharpness: number;
  exposure: number;
  faceCount: number;
  highlightClipping?: number;
  shadowClipping?: number;
  horizonTiltDeg?: number;
  ruleOfThirds?: number;
  faces?: { box: [number, number, number, number] }[];
}

export interface CorrectionPlan {
  photoId: string;
  fixes: RescueFix[];
  adjustments: EditAdjustments;
}

export function planKeptCorrections(photos: readonly CorrectablePhoto[]): CorrectionPlan[] {
  const plans: CorrectionPlan[] = [];
  for (const photo of photos) {
    if (photo.status !== 'selected') continue;
    const wanted = fixesFor(photo);
    if (!wanted.length) continue;
    const adjustments: EditAdjustments = { ...NEUTRAL_ADJUSTMENTS };
    const applied: RescueFix[] = [];

    if (wanted.includes('exposure')) {
      const value = computeAutoExposureFromScore(photo.exposure);
      if (value) {
        adjustments.exposure = value;
        applied.push('exposure');
      }
    }
    if (wanted.includes('highlights') || wanted.includes('shadows')) {
      const tone = computeAutoHighlightsShadows(
        wanted.includes('highlights') ? photo.highlightClipping : 0,
        wanted.includes('shadows') ? photo.shadowClipping : 0
      );
      if (wanted.includes('highlights') && tone.highlights) {
        adjustments.highlights = tone.highlights;
        applied.push('highlights');
      }
      if (wanted.includes('shadows') && tone.shadows) {
        adjustments.shadows = tone.shadows;
        applied.push('shadows');
      }
    }
    if (wanted.includes('straighten') && photo.horizonTiltDeg !== undefined && Math.abs(photo.horizonTiltDeg) > 2) {
      const rotation = Math.round(Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, -photo.horizonTiltDeg)));
      if (rotation) {
        adjustments.rotationDeg = rotation;
        applied.push('straighten');
      }
    }
    if (wanted.includes('crop')) {
      const crop = computeAutoCrop({
        faceCount: photo.faceCount,
        ruleOfThirds: photo.ruleOfThirds,
        faces: photo.faces
      });
      if (crop) {
        adjustments.crop = crop;
        applied.push('crop');
      }
    }
    if (applied.length) plans.push({ photoId: photo.id, fixes: applied, adjustments });
  }
  return plans;
}

/** Primele N corecturi sunt mostra. Cu Premium, toate. */
export function freeSample<T>(items: readonly T[], premium: boolean, limit = FREE_AUTO_CORRECT_PHOTOS): { allowed: T[]; locked: T[] } {
  if (premium) return { allowed: [...items], locked: [] };
  return { allowed: items.slice(0, limit), locked: items.slice(limit) };
}

/** „ana.jpg” → „ana-corectat.jpg”. Copia, nu originalul. */
export function correctedFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName}-corectat`;
  return `${fileName.slice(0, dot)}-corectat${fileName.slice(dot)}`;
}
