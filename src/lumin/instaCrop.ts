/**
 * lumin/instaCrop.ts
 * Decuparea pentru Instagram: 4:5 (postare), 9:16 (story), 1:1. Cel mai mare
 * cadru cu proporția cerută care încape în poză, așezat pe fețe: pe orizontală
 * centrat pe ele, pe verticală cu fețele în treimea de sus (unde le pune un
 * fotograf), nu tăiate la mijloc. Fără fețe: centrul pozei.
 */
export type InstaFormat = '4:5' | '9:16' | '1:1';
export const INSTA_FORMATS: readonly InstaFormat[] = ['4:5', '9:16', '1:1'];
const RATIO: Record<InstaFormat, number> = { '4:5': 4 / 5, '9:16': 9 / 16, '1:1': 1 };
/** Lățimea la care o cere Instagram; mai mic doar dacă poza nu are atât. */
export const INSTA_WIDTH = 1080;

export interface CropRect { x: number; y: number; w: number; h: number }
type Box = readonly [number, number, number, number];

/** Unde stau fețele în cadru, pe verticală (0 = sus): puțin peste treimea de sus. */
const FACE_LINE = 0.36;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Cadrul, în pixeli ai pozei. `faces` are cutii normalizate [x, y, w, h] (0..1),
 * ca în analiza de la import.
 */
export function instaCrop(width: number, height: number, format: InstaFormat, faces?: readonly { box: Box }[]): CropRect {
  const ratio = RATIO[format];
  const w = width / height > ratio ? height * ratio : width;
  const h = w / ratio;
  let cx = width / 2;
  let cy = height / 2;
  let top = (height - h) / 2;
  const boxes = (faces ?? []).map(f => f.box).filter(b => b[2] > 0 && b[3] > 0);
  if (boxes.length) {
    // Toate fețele, dacă încap; altfel cea mai mare (omul principal).
    let x0 = Math.min(...boxes.map(b => b[0])) * width;
    let x1 = Math.max(...boxes.map(b => b[0] + b[2])) * width;
    let y0 = Math.min(...boxes.map(b => b[1])) * height;
    let y1 = Math.max(...boxes.map(b => b[1] + b[3])) * height;
    if (x1 - x0 > w) {
      const main = boxes.reduce((a, b) => (a[2] * a[3] >= b[2] * b[3] ? a : b));
      x0 = main[0] * width; x1 = (main[0] + main[2]) * width;
      y0 = main[1] * height; y1 = (main[1] + main[3]) * height;
    }
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
    top = cy - h * FACE_LINE;
    // Nicio față tăiată sus.
    top = Math.min(top, y0 - h * 0.06);
  }
  const x = clamp(cx - w / 2, 0, width - w);
  const y = clamp(top, 0, height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
