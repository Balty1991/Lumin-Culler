/**
 * core/autoLook.ts
 * Corecția automată „wow”, pe telefon, fără rețea.
 *
 * Măsoară ce e stricat la poza asta (întuneric, supraexpunere, contralumina,
 * dominantă de culoare, ceață, zgomot, moliciune, cer spălăcit, ochi roșii,
 * ten) și întoarce reglaje pe care le aplică deja editorul, plus o trecere
 * locală: fața se luminează separat de fundal, pupila roșie se stinge.
 *
 * Plafoanele sunt intenționat sub un filtru de telefon. O poză deja bună
 * primește aproape nimic.
 */
export type LookIssue =
  | 'underexposed'
  | 'overexposed'
  | 'backlit'
  | 'cast'
  | 'haze'
  | 'noise'
  | 'soft'
  | 'flat'
  | 'dullSky'
  | 'redEye'
  | 'skin';

export interface LookFace { box: [number, number, number, number] }

export interface LookRecipe {
  issues: LookIssue[];
  /** Reglaje de adăugat peste corecția de bază, deja plafonate. */
  adjustments: Record<string, number>;
  relight: number;
  redEye: number;
  faces: LookFace[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export interface FrameStats {
  mean: number;
  p10: number;
  p90: number;
  dark: number;
  bright: number;
  sat: number;
  cast: number;
  /** Dominantă pe aproape toți pixelii, nu doar pe gri. Prinde becul portocaliu. */
  globalCast: number;
  tint: number;
  neutral: number;
  haze: number;
  noise: number;
  sharp: number;
  skyLum: number;
  skySat: number;
  faceMean: number | null;
  restMean: number | null;
  redEye: number;
  skinCast: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** Statistici pe un buffer RGBA. `step` sare pixeli; fețele sunt în 0..1. */
export function measureFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  faces: readonly LookFace[] = [],
  step = 1
): FrameStats {
  const lums: number[] = [];
  let sum = 0, n = 0, dark = 0, bright = 0, satSum = 0, satN = 0;
  let nr = 0, ng = 0, nb = 0, neutral = 0;
  let gr = 0, gb = 0, gn = 0;
  let skyLum = 0, skySat = 0, skyN = 0;
  let noise = 0, noiseN = 0, sharp = 0, sharpN = 0;
  let faceSum = 0, faceN = 0, restSum = 0, restN = 0, redEye = 0;
  let skinG = 0, skinN = 0;
  const stride = Math.max(1, step | 0);
  const boxes = faces.filter(f => f.box[2] > 0.01 && f.box[3] > 0.01);

  const inFace = (x: number, y: number) => {
    const u = x / width, v = y / height;
    return boxes.some(f => u >= f.box[0] && u <= f.box[0] + f.box[2] && v >= f.box[1] && v <= f.box[1] + f.box[3]);
  };

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = lumaOf(r, g, b);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      lums.push(lum);
      sum += lum;
      n++;
      if (lum < 48) dark++;
      else if (lum > 228) bright++;
      if (lum > 30 && lum < 235) { satSum += sat; satN++; }
      if (lum > 40 && lum < 230 && sat < 0.38) { nr += r; ng += g; nb += b; neutral++; }
      if (lum > 40 && lum < 220 && sat < 0.72) { gr += r; gb += b; gn++; }
      if (y < height * 0.28) { skyLum += lum; skySat += sat; skyN++; }
      const face = inFace(x, y);
      if (face) faceSum += lum; else restSum += lum;
      if (face) faceN++; else restN++;
      // Ochi roșii = pupilă roșu aprins de la blitz, nu ten rozaliu (detectorul vechi
      // prindea obrajii unui copil și înnegrea zona ochilor — raportat cu captură).
      if (face && r > 150 && g < 90 && b < 100 && r > g * 2.1 && r > b * 1.8) {
        const v = y / height;
        const box = boxes.find(f => {
          const u = x / width;
          return u >= f.box[0] && u <= f.box[0] + f.box[2] && v >= f.box[1] && v <= f.box[1] + f.box[3];
        });
        if (box) {
          const fy = (v - box.box[1]) / box.box[3];
          if (fy > 0.12 && fy < 0.48) redEye++;
        }
      }
      if (face && r > g && g > b && r - b > 12 && r - b < 90 && sat < 0.45 && lum > 40 && lum < 220) {
        skinG += g - (r + b) / 2;
        skinN++;
      }
      if ((x + y) % (stride * 2) === 0) {
        const c = lum;
        const lap = lumaOf(data[i - 4], data[i - 3], data[i - 2])
          + lumaOf(data[i + 4], data[i + 5], data[i + 6])
          + lumaOf(data[i - width * 4], data[i - width * 4 + 1], data[i - width * 4 + 2])
          + lumaOf(data[i + width * 4], data[i + width * 4 + 1], data[i + width * 4 + 2])
          - 4 * c;
        const mag = Math.abs(lap);
        sharp += mag;
        sharpN++;
        if (sat < 0.12 && lum > 20 && lum < 200) { noise += mag; noiseN++; }
      }
    }
  }

  lums.sort((a, b) => a - b);
  const mean = n ? sum / n / 255 : 0.5;
  const p10 = percentile(lums, 0.1) / 255;
  const p90 = percentile(lums, 0.9) / 255;
  const meanR = neutral ? nr / neutral : 128;
  const meanG = neutral ? ng / neutral : 128;
  const meanB = neutral ? nb / neutral : 128;
  return {
    mean, p10, p90,
    dark: n ? dark / n : 0,
    bright: n ? bright / n : 0,
    sat: satN ? satSum / satN : 0,
    cast: (meanB - meanR) / 255,
    globalCast: gn > 8 ? (gb / gn - gr / gn) / 255 : 0,
    tint: (meanG - (meanR + meanB) / 2) / 255,
    neutral: n ? neutral / n : 0,
    haze: p10 > 0.18 && (p90 - p10) < 0.55 ? (p10 - 0.12) / 0.4 : 0,
    noise: noiseN ? noise / noiseN : 0,
    sharp: sharpN ? sharp / sharpN : 0,
    skyLum: skyN ? skyLum / skyN / 255 : 0,
    skySat: skyN ? skySat / skyN : 1,
    faceMean: faceN > 4 ? faceSum / faceN / 255 : null,
    restMean: restN > 4 ? restSum / restN / 255 : null,
    redEye,
    skinCast: skinN > 6 ? skinG / skinN / 255 : 0
  };
}

function add(out: Record<string, number>, key: string, value: number, lo = -36, hi = 36): void {
  const v = Math.round(clamp(value, lo, hi));
  if (!v) return;
  out[key] = v;
}

/**
 * Rețeta pentru statistica asta. Numerele sunt delta-uri de slider, nu
 * înlocuiri: editorul le adună peste ce a măsurat deja.
 */
export function recipeFromStats(s: FrameStats, faces: readonly LookFace[] = []): LookRecipe {
  const issues: LookIssue[] = [];
  const adjustments: Record<string, number> = {};
  let relight = 0;
  let redEye = 0;
  const backlit = s.faceMean !== null && s.restMean !== null && s.faceMean < 0.5 && s.restMean > s.faceMean * 1.45 && s.restMean - s.faceMean > 0.12;

  if (backlit) {
    issues.push('backlit');
    add(adjustments, 'shadows', 22 + (0.42 - (s.faceMean ?? 0.3)) * 36, 0, 36);
    add(adjustments, 'highlights', -8 - Math.max(0, (s.restMean ?? 0.7) - 0.65) * 24, -22, 0);
    // Fără ton local aici: media din jurul feței e fundalul aprins, iar tonul local ar întuneca fața.
    relight = Math.round(clamp(55 + (0.45 - (s.faceMean ?? 0.3)) * 70, 50, 80));
    if ((s.faceMean ?? 1) < 0.32) add(adjustments, 'exposure', 8, 0, 14);
  } else if (s.mean < 0.42 || s.p10 < 0.08 && s.mean < 0.5) {
    issues.push('underexposed');
    const gap = 0.52 - s.mean;
    add(adjustments, 'exposure', gap * 90, 0, 34);
    add(adjustments, 'shadows', 10 + s.dark * 40, 0, 32);
    add(adjustments, 'toneMap', 18 + s.dark * 50, 0, 58);
    if (s.faceMean !== null && s.faceMean < 0.48) relight = Math.round(clamp((0.55 - s.faceMean) * 90, 18, 56));
  } else if (s.mean > 0.78 && s.p90 > 0.84 && s.dark < 0.05 && (s.faceMean === null || s.faceMean > 0.78)) {
    issues.push('overexposed');
    add(adjustments, 'exposure', (0.64 - s.mean) * 50, -18, 0);
    add(adjustments, 'highlights', -12 - s.bright * 30, -30, 0);
    add(adjustments, 'toneMap', 16, 0, 36);
  }

  if (!backlit && s.dark > 0.18 && s.bright > 0.08) {
    add(adjustments, 'toneMap', Math.max(adjustments.toneMap ?? 0, Math.round(clamp(s.dark * 80 + s.bright * 40, 22, 64))), 0, 68);
  }

  const cast = Math.abs(s.cast) >= Math.abs(s.globalCast) ? s.cast : s.globalCast;
  // Albul se corectează cu măsură: lumina caldă de apus și culorile de noapte sunt
  // atmosfera pozei, nu o greșeală (testat: −40 spăla un portret la apus, +26/+30
  // înverzea un oraș noaptea). Răcirea e mică; noaptea nu se atinge.
  const night = s.mean < 0.26;
  if (!night && ((s.neutral > 0.04 && Math.abs(s.cast) > 0.025) || Math.abs(s.globalCast) > 0.12)) {
    issues.push('cast');
    // cast > 0 înseamnă albastru în exces (meanB > meanR) → încălzim (temperature > 0).
    // Doar o dominantă albastră clară primește căldură mai multă; una mică doar se atinge.
    add(adjustments, 'temperature', cast * 100, -8, cast > 0.1 ? 12 : 6);
  }
  if (!night && s.neutral > 0.04 && Math.abs(s.tint) > 0.02) {
    if (!issues.includes('cast')) issues.push('cast');
    add(adjustments, 'tint', -s.tint * 140, -8, 8);
  }

  if (!backlit && s.dark < 0.12 && Math.abs(s.globalCast) < 0.15 && s.haze > 0.15 && s.mean > 0.3) {
    issues.push('haze');
    add(adjustments, 'dehaze', 14 + s.haze * 28, 0, 34);
    add(adjustments, 'contrast', 6, 0, 12);
    add(adjustments, 'blacks', -6, -12, 0);
  } else if (pSpan(s) < 0.42 && s.mean > 0.25 && s.mean < 0.75) {
    issues.push('flat');
    add(adjustments, 'contrast', 12, 0, 18);
    add(adjustments, 'clarity', 10, 0, 16);
    add(adjustments, 'whites', 8, 0, 14);
    add(adjustments, 'blacks', -6, -12, 0);
  }

  if (s.noise > 18 && s.mean < 0.45) {
    issues.push('noise');
    add(adjustments, 'noiseReduction', 22 + Math.min(20, (s.noise - 18) * 1.2), 0, 48);
    add(adjustments, 'sharpen', 6, 0, 10);
    add(adjustments, 'clarity', -4, -8, 0);
  } else if (!issues.includes('backlit') && s.sharp < 8 && s.mean > 0.2) {
    issues.push('soft');
    add(adjustments, 'sharpen', 16, 0, 24);
    add(adjustments, 'clarity', 10, 0, 16);
  } else if (!issues.includes('noise') && !issues.includes('backlit')) {
    add(adjustments, 'sharpen', 8, 0, 12);
    add(adjustments, 'clarity', 6, 0, 12);
  }

  // Doar cerul deja albăstrui, spălăcit, se adâncește. Cerul alb/gri (înnorat) nu se
  // vopsește automat: ieșea un halou gri-albăstrui în jurul capului (raportat).
  if (!backlit && s.skyLum > 0.55 && s.skySat >= 0.08 && s.skySat < 0.14 && s.skyLum < 0.88 && s.dark < 0.15) {
    issues.push('dullSky');
    add(adjustments, 'sky', 10 + (0.14 - s.skySat) * 60, 0, 18);
    add(adjustments, 'dehaze', Math.max(adjustments.dehaze ?? 0, 8), 0, 34);
  }

  if (s.sat < 0.1 && s.sat > 0.04 && !issues.includes('noise')) {
    add(adjustments, 'saturation', 6, 0, 10);
  }

  // Tenul se repară doar pe axa verde–magenta: încălzirea în plus îngălbenea toată poza.
  if (s.skinCast > 0.025) {
    issues.push('skin');
    add(adjustments, 'tint', (adjustments.tint ?? 0) - 5, -10, 10);
  } else if (s.skinCast < -0.03) {
    issues.push('skin');
    add(adjustments, 'tint', (adjustments.tint ?? 0) + 4, -10, 10);
  }

  if (backlit) {
    if ((adjustments.temperature ?? 0) < 0) adjustments.temperature = 4;
    delete adjustments.dehaze;
    delete adjustments.contrast;
  }

  if (s.redEye >= 6) {
    issues.push('redEye');
    redEye = 100;
  }

  if (s.faceMean !== null && !backlit && s.faceMean < 0.5 && relight === 0) {
    relight = Math.round(clamp((0.58 - s.faceMean) * 70, 0, 40));
  }

  return { issues, adjustments, relight, redEye, faces: faces.map(f => ({ box: [...f.box] as [number, number, number, number] })) };
}

function pSpan(s: FrameStats): number {
  return s.p90 - s.p10;
}

/** Aplică delta-urile rețetei peste reglajele deja calculate, fără dublare oarbă. */
export function mergeRecipe<T extends { temperature: number; relight?: number; redEye?: number; faceBoxes?: LookFace[] }>(
  base: T,
  recipe: LookRecipe
): T {
  const out = { ...base, faceBoxes: recipe.faces.length ? recipe.faces : base.faceBoxes };
  const bag = out as unknown as Record<string, number>;
  for (const [key, extra] of Object.entries(recipe.adjustments)) {
    const cur = bag[key] ?? 0;
    const lo = key === 'sharpen' || key === 'noiseReduction' || key === 'toneMap' || key === 'dehaze' || key === 'sky' ? 0
      : key === 'clarity' ? -20 : -40;
    const hi = key === 'sky' || key === 'dehaze' || key === 'toneMap' ? 70 : 40;
    const next = Math.abs(extra) >= Math.abs(cur) ? extra : cur;
    bag[key] = Math.round(clamp(next, lo, hi));
  }
  if (recipe.relight) out.relight = Math.round(clamp(Math.max(out.relight ?? 0, recipe.relight), 0, 80));
  if (recipe.redEye) out.redEye = 100;
  // Pe cer înnorat nu răcim: albastrul în plus face poza vânătă.
  if (recipe.issues.includes('dullSky')) out.temperature = Math.max(-2, out.temperature);
  return out;
}

/**
 * Fața se deschide local, fundalul arzător coboară puțin, pupila roșie se stinge.
 * `faces` sunt în 0..1. Nu atinge tonurile medii din afara feței.
 */
export function applySubjectFinish(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  relight: number,
  redEye: number,
  faces: readonly LookFace[] | undefined
): void {
  const rel = clamp(relight / 100, 0, 1);
  const eye = clamp(redEye / 100, 0, 1);
  if ((rel < 0.02 && eye < 0.02) || !faces?.length) return;

  for (const face of faces) {
    const [fx, fy, fw, fh] = face.box;
    if (!(fw > 0.02) || !(fh > 0.02)) continue;
    const x0 = Math.max(0, Math.floor((fx - fw * 0.15) * width));
    const x1 = Math.min(width, Math.ceil((fx + fw * 1.15) * width));
    const y0 = Math.max(0, Math.floor((fy - fh * 0.05) * height));
    const y1 = Math.min(height, Math.ceil((fy + fh * 2.4) * height));
    const cx = (fx + fw / 2) * width;
    const cy = (fy + fh * 0.42) * height;
    const rx = Math.max(2, fw * width * 0.72);
    const ry = Math.max(2, fh * height * 1.35);

    let sum = 0, count = 0;
    if (rel > 0) {
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;
          const i = (y * width + x) * 4;
          sum += lumaOf(data[i], data[i + 1], data[i + 2]);
          count++;
        }
      }
    }
    const faceLum = count ? sum / count : 128;
    const lift = rel * clamp((150 - faceLum) / 150, 0, 1);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        let r = data[i], g = data[i + 1], b = data[i + 2];
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (rel > 0 && d2 < 1) {
          const fall = 1 - d2;
          const gain = 1 + lift * 0.55 * fall;
          r *= gain; g *= gain; b *= gain;
          // Tenul rămâne cald, nu gri de la câștig.
          r += 6 * lift * fall;
          b -= 4 * lift * fall;
        } else if (rel > 0.4 && y < cy && lumaOf(r, g, b) > 200) {
          const pull = (rel - 0.4) * 0.18;
          r -= (r - 210) * pull; g -= (g - 210) * pull; b -= (b - 220) * pull;
        }
        if (eye > 0) {
          const u = x / width, v = y / height;
          const fyFace = (v - fy) / fh;
          const fxFace = (u - fx) / fw;
          if (fyFace > 0.14 && fyFace < 0.46 && fxFace > 0.12 && fxFace < 0.88
            && r > 150 && g < 90 && b < 100 && r > g * 2.1 && r > b * 1.8) {
            const yv = lumaOf(r, g, b);
            const mix = eye * 0.85;
            r = r * (1 - mix) + yv * 0.35 * mix;
            g = g * (1 - mix) + yv * 0.32 * mix;
            b = b * (1 - mix) + yv * 0.3 * mix;
          }
        }
        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
  }
}

export function recipeToAdjustments(recipe: LookRecipe): {
  exposure: number; contrast: number; saturation: number; temperature: number; tint: number;
  highlights: number; shadows: number; relight: number; redEye: number;
  whites: number; blacks: number; sharpen: number; clarity: number; noiseReduction: number;
  toneMap: number; dehaze: number; sky: number; faceBoxes: LookFace[];
} & Record<string, number | LookFace[] | undefined> {
  return {
    exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0,
    whites: 0, blacks: 0, sharpen: 0, clarity: 0, noiseReduction: 0, toneMap: 0, dehaze: 0, sky: 0,
    ...recipe.adjustments,
    relight: recipe.relight,
    redEye: recipe.redEye,
    faceBoxes: recipe.faces
  };
}

/** Expunere, contrast, culoare, umbre și lumini — aceleași ponderi ca în drawAdjusted. */
export function applySliderGrade(data: Uint8ClampedArray, a: {
  exposure?: number; contrast?: number; saturation?: number; temperature?: number; tint?: number;
  highlights?: number; shadows?: number; whites?: number; blacks?: number;
}): void {
  const brightness = 1 + (a.exposure ?? 0) / 100;
  const contrast = 1 + (a.contrast ?? 0) / 100;
  const saturate = 1 + (a.saturation ?? 0) / 100;
  const tempShift = ((a.temperature ?? 0) / 100) * 40;
  const tintShift = ((a.tint ?? 0) / 100) * 40;
  const highlightAmt = ((a.highlights ?? 0) / 100) * 60;
  const shadowAmt = ((a.shadows ?? 0) / 100) * 60;
  const whiteAmt = ((a.whites ?? 0) / 100) * 55;
  const blackAmt = ((a.blacks ?? 0) / 100) * 55;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * brightness;
    let g = data[i + 1] * brightness;
    let b = data[i + 2] * brightness;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * saturate;
    g = y + (g - y) * saturate;
    b = y + (b - y) * saturate;
    r += tempShift - tintShift / 2;
    b -= tempShift + tintShift / 2;
    g += tintShift;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const hiWeight = Math.max(0, (lum - 128) / 127);
    const shWeight = Math.max(0, (128 - lum) / 128);
    const t = Math.max(0, Math.min(1, lum / 255));
    const delta = highlightAmt * hiWeight + shadowAmt * shWeight + whiteAmt * t * t * t + blackAmt * (1 - t) * (1 - t) * (1 - t);
    r += delta; g += delta; b += delta;
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

export function meanLuma(data: Uint8ClampedArray): number {
  let s = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) s += lumaOf(data[i], data[i + 1], data[i + 2]);
  return n ? s / n / 255 : 0;
}

export function meanCast(data: Uint8ClampedArray): number {
  let r = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = lumaOf(data[i], data[i + 1], data[i + 2]);
    if (lum < 40 || lum > 230) continue;
    r += data[i]; b += data[i + 2]; n++;
  }
  return n ? (b - r) / n / 255 : 0;
}
