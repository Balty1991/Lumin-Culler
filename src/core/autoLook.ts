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
  /** Grade. Pozitiv = orizontul urcă spre dreapta. 0 = nu se îndreaptă. */
  horizonDeg: number;
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
  /** Interiorul elipsei feței, fără marginea aprinsă. Null fără față. */
  faceCore: number | null;
  /** Claritatea în interiorul feței (bokeh-ul din fundal nu intră aici). */
  faceSharp: number | null;
  /** Lumina din jurul capului, nu hainele. Null fără față. */
  haloMean: number | null;
  /** Cât din halou e aproape alb (fereastră, soare). */
  haloBright: number;
  /** Înclinarea orizontului, în grade. 0 dacă nu e un orizont clar, mic. */
  horizonDeg: number;
  redEye: number;
  /** Câți pixeli s-au măsurat (pentru proporții). */
  pixels: number;
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
  let coreSum = 0, coreN = 0, faceSharp = 0, faceSharpN = 0;
  let haloSum = 0, haloN = 0, haloBright = 0;
  const bandSum = [new Float64Array(height), new Float64Array(height), new Float64Array(height)];
  const bandN = [new Uint16Array(height), new Uint16Array(height), new Uint16Array(height)];
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
      let core = false, halo = false;
      for (const f of boxes) {
        const cx = (f.box[0] + f.box[2] / 2) * width;
        const cy = (f.box[1] + f.box[3] * 0.46) * height;
        const rx = Math.max(2, f.box[2] * width * 0.46);
        const ry = Math.max(2, f.box[3] * height * 0.5);
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.72) { core = true; halo = false; break; }
        if (d2 < 2.35 && dy < 0.35) halo = true;
      }
      if (core) { coreSum += lum; coreN++; }
      else if (halo) { haloSum += lum; haloN++; if (lum > 196) haloBright++; }
      if (y > height * 0.08 && y < height * 0.78) {
        const b = x < width * 0.33 ? 0 : x < width * 0.66 ? 1 : 2;
        bandSum[b][y] += lum;
        bandN[b][y]++;
      }
      // Ochi roșii = pupilă roșu aprins de la blitz, nu ten rozaliu (detectorul vechi
      // prindea obrajii unui copil și înnegrea zona ochilor — raportat cu captură).
      if (face && r > 150 && g < 90 && b < 100 && r > g * 2.1 && r > b * 1.8 && b < g * 1.6 + 20) {
        const v = y / height;
        const box = boxes.find(f => {
          const u = x / width;
          return u >= f.box[0] && u <= f.box[0] + f.box[2] && v >= f.box[1] && v <= f.box[1] + f.box[3];
        });
        if (box) {
          const fy = (v - box.box[1]) / box.box[3];
          const fx = (x / width - box.box[0]) / box.box[2];
          if (fy > 0.2 && fy < 0.55 && fx > 0.12 && fx < 0.88) redEye++;
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
        if (core) { faceSharp += mag; faceSharpN++; }
        // Textura feței (ten, sprâncene) nu e zgomot. Altfel un portret clar
        // primește reducere de zgomot și tenul se șterge.
        if (!face && sat < 0.12 && lum > 20 && lum < 200) { noise += mag; noiseN++; }
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
    faceCore: coreN > 4 ? coreSum / coreN / 255 : (faceN > 4 ? faceSum / faceN / 255 : null),
    faceSharp: faceSharpN > 4 ? faceSharp / faceSharpN : null,
    haloMean: haloN > 4 ? haloSum / haloN / 255 : null,
    haloBright: haloN > 4 ? haloBright / haloN : 0,
    horizonDeg: horizonDegrees(bandSum, bandN, width, height),
    redEye,
    pixels: n,
    skinCast: skinN > 6 ? skinG / skinN / 255 : 0
  };
}

/** Orizont clar, înclinat puțin (1,5°–7,5°). Unghiul mare, voit, rămâne. */
function horizonDegrees(sum: Float64Array[], n: Uint16Array[], width: number, height: number): number {
  const filled = (band: number, y: number): number | null => {
    for (let k = 0; k <= 6; k++) {
      const yy = Math.min(height - 1, y + k);
      if (n[band][yy]) return sum[band][yy] / n[band][yy];
    }
    return null;
  };
  const edge = (band: number): { y: number; strength: number } | null => {
    let best = 0, at = -1;
    const lo = Math.floor(height * 0.12), hi = Math.floor(height * 0.8);
    for (let y = lo; y < hi; y += 2) {
      const a = filled(band, y);
      const b = filled(band, y + 8);
      if (a === null || b === null) continue;
      const d = Math.abs(a - b);
      if (d > best) { best = d; at = y; }
    }
    return at < 0 || best < 14 ? null : { y: at, strength: best };
  };
  const left = edge(0), mid = edge(1), right = edge(2);
  if (!left || !mid || !right) return 0;
  const ys = [left.y, mid.y, right.y];
  if (Math.max(...ys) - Math.min(...ys) > height * 0.28) return 0;
  if (Math.abs(mid.y - (left.y + right.y) / 2) > height * 0.08) return 0;
  const angle = Math.atan2(right.y - left.y, width * 0.66) * 180 / Math.PI;
  if (Math.abs(angle) < 1.5 || Math.abs(angle) > 7.5) return 0;
  return Math.round(angle * 10) / 10;
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
  // Contralumina e un cap întunecat cu un halou aprins (fereastră, soare), nu
  // un ten închis pe haine mai deschise. Fără halou, relight-ul deschidea
  // portrete deja bune.
  const core = s.faceCore;
  const backlit = core !== null && s.haloMean !== null && core < 0.48
    && s.haloBright > 0.16 && s.haloMean > core + 0.2;

  if (backlit) {
    issues.push('backlit');
    const dark = core ?? 0.3;
    add(adjustments, 'shadows', 18 + (0.4 - dark) * 40, 0, 36);
    add(adjustments, 'highlights', -10 - Math.max(0, (s.haloMean ?? 0.7) - 0.62) * 28, -24, 0);
    // Fără ton local aici: media din jurul feței e fundalul aprins, iar tonul local ar întuneca fața.
    relight = Math.round(clamp(48 + (0.42 - dark) * 80, dark < 0.32 ? 58 : 36, 80));
    if (dark < 0.3) add(adjustments, 'exposure', 8, 0, 12);
  } else if (!(core !== null && core > 0.22 && s.mean > 0.36) && (s.mean < 0.42 || s.p10 < 0.08 && s.mean < 0.5)) {
    issues.push('underexposed');
    const gap = 0.52 - s.mean;
    add(adjustments, 'exposure', gap * 90, 0, 34);
    add(adjustments, 'shadows', 10 + s.dark * 40, 0, 32);
    add(adjustments, 'toneMap', 18 + s.dark * 50, 0, 58);
    if (core !== null && core < 0.42 && s.haloBright > 0.1) relight = Math.round(clamp((0.5 - core) * 90, 18, 56));
  } else if (s.mean > 0.78 && s.p90 > 0.84 && s.dark < 0.05 && (s.faceMean === null || s.faceMean > 0.78)) {
    issues.push('overexposed');
    add(adjustments, 'exposure', (0.64 - s.mean) * 50, -18, 0);
    add(adjustments, 'highlights', -12 - s.bright * 30, -30, 0);
    add(adjustments, 'toneMap', 16, 0, 36);
  }

  if (!backlit && s.dark > 0.18 && s.bright > 0.08) {
    add(adjustments, 'toneMap', Math.max(adjustments.toneMap ?? 0, Math.round(clamp(s.dark * 80 + s.bright * 40, 22, 64))), 0, 68);
  }

  // Culoarea hainelor nu e balans de alb. Dacă există pixeli aproape gri, ei decid.
  const cast = s.neutral > 0.035 ? s.cast : s.globalCast;
  // Albul se corectează cu măsură: lumina caldă de apus și culorile de noapte sunt
  // atmosfera pozei, nu o greșeală (testat: −40 spăla un portret la apus, +26/+30
  // înverzea un oraș noaptea). Răcirea e mică; noaptea nu se atinge.
  // Aurul de apus pe o față deja deschisă nu se răcește: ieșea un ten cenușiu.
  const night = s.mean < 0.26;
  const golden = cast < 0 && (s.skyLum > 0.62 || (core !== null && core > 0.5 && s.globalCast < -0.08));
  if (!night && !golden && ((s.neutral > 0.04 && Math.abs(s.cast) > 0.05) || (s.neutral <= 0.035 && Math.abs(s.globalCast) > 0.12))) {
    issues.push('cast');
    // cast > 0 înseamnă albastru în exces (meanB > meanR) → încălzim (temperature > 0).
    // Doar o dominantă albastră clară primește căldură mai multă; una mică doar se atinge.
    add(adjustments, 'temperature', cast * 100, -8, cast > 0.1 ? 12 : 6);
  }
  if (!night && s.neutral > 0.04 && Math.abs(s.tint) > 0.02) {
    if (!issues.includes('cast')) issues.push('cast');
    add(adjustments, 'tint', -s.tint * 140, -8, 8);
  }

  if (!backlit && s.haze > 0.2 && s.dark < 0.16 && s.mean > 0.3 && Math.abs(s.cast) < 0.1) {
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

  // Fața clară și fundalul topit nu înseamnă o poză moale: claritatea globală
  // e mică din cauza bokeh-ului, iar accentuarea strică tocmai fundalul.
  const bokeh = s.faceSharp !== null && s.faceSharp > 8 && s.sharp < 16;
  const texturedFace = s.faceSharp !== null && s.faceSharp > 18;
  if (s.noise > 18 && s.mean < 0.45 && !texturedFace) {
    issues.push('noise');
    add(adjustments, 'noiseReduction', 22 + Math.min(20, (s.noise - 18) * 1.2), 0, 48);
    if (!bokeh) add(adjustments, 'sharpen', 6, 0, 10);
    add(adjustments, 'clarity', -4, -8, 0);
  } else if (!issues.includes('backlit') && !bokeh && s.sharp < 8 && s.mean > 0.2) {
    issues.push('soft');
    add(adjustments, 'sharpen', 16, 0, 24);
    add(adjustments, 'clarity', 10, 0, 16);
  } else if (!issues.includes('noise') && !issues.includes('backlit') && !bokeh && !texturedFace) {
    add(adjustments, 'sharpen', 8, 0, 12);
    add(adjustments, 'clarity', 6, 0, 12);
  }

  // Doar cerul deja albăstrui, spălăcit, se adâncește. Cerul alb/gri (înnorat) nu se
  // vopsește automat: ieșea un halou gri-albăstrui în jurul capului (raportat).
  if (!backlit && s.skyLum > 0.55 && s.skySat >= 0.08 && s.skySat < 0.14 && s.skyLum < 0.88 && s.dark < 0.15) {
    issues.push('dullSky');
    // Fără „sky”: colora și pielea/hainele albe (auditul); doar dehaze-ul ușor rămâne.
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

  // Pupilele sunt mici: multe pixeli roșii pe față înseamnă glugă sau căciulă roșie (raportat).
  const faceArea = faces.reduce((n, f) => n + f.box[2] * f.box[3], 0);
  if (s.redEye >= 6 && (!faceArea || s.redEye < faceArea * s.pixels * 0.06)) {
    issues.push('redEye');
    redEye = 100;
  }

  // Doar o față chiar întunecată, cu ceva lumină în jur, mai primește relight.
  // Un ten închis bine expus stă sub 0,5 și nu trebuie „reparat”.
  if (core !== null && !backlit && relight === 0 && core < 0.34 && s.haloBright > 0.08 && (s.haloMean ?? 0) > core + 0.16) {
    relight = Math.round(clamp((0.48 - core) * 80, 0, 36));
  }
  // Față în umbră lângă o zonă luminoasă (fereastră), chiar dacă haloul imediat
  // e tot umbră. Tenul închis nu intră: acolo p90 nu e o fereastră.
  if (core !== null && !backlit && relight === 0 && core < 0.38 && s.p90 > 0.78 && s.dark > 0.12 && s.mean > 0.38) {
    issues.push('backlit');
    relight = Math.round(clamp((0.5 - core) * 90, 32, 58));
    add(adjustments, 'shadows', 16, 0, 28);
    add(adjustments, 'highlights', -8, -16, 0);
  }
  if (!backlit && s.skyLum > 0.62 && s.skySat < 0.13 && s.mean > 0.32 && s.mean < 0.72 && Math.abs(s.cast) < 0.1 && !issues.includes('haze')) {
    issues.push('haze');
    add(adjustments, 'dehaze', 18, 0, 32);
    add(adjustments, 'contrast', 8, 0, 14);
  }

  if (!backlit && s.p90 > 0.84 && s.bright > 0.045 && s.mean < 0.74 && (adjustments.highlights ?? 0) > -6) {
    add(adjustments, 'highlights', -8 - Math.max(0, s.p90 - 0.84) * 40, -18, 0);
  }

  return {
    issues, adjustments, relight, redEye, horizonDeg: s.horizonDeg,
    faces: faces.map(f => ({ box: [...f.box] as [number, number, number, number] }))
  };
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
    const lift = rel * clamp((168 - faceLum) / 150, 0, 1);
    const crushed = faceLum < 105;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        let r = data[i], g = data[i + 1], b = data[i + 2];
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (rel > 0 && d2 < 1) {
          const fall = 1 - d2;
          const gain = 1 + lift * (crushed ? 0.92 : 0.5) * fall;
          const open = lift * (crushed ? 28 : 6) * fall;
          r = r * gain + open; g = g * gain + open; b = b * gain + open;
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

/** Îndreaptă un orizont mic. Colțurile repetă marginea, ca să nu apară benzi negre. */
export function rotateBuffer(src: Uint8ClampedArray, w: number, h: number, deg: number): Uint8ClampedArray {
  if (Math.abs(deg) < 0.4) return src;
  const out = new Uint8ClampedArray(src.length);
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      let sx = c * dx + s * dy + cx;
      let sy = -s * dx + c * dy + cy;
      sx = sx < 0 ? 0 : sx > w - 1.001 ? w - 1.001 : sx;
      sy = sy < 0 ? 0 : sy > h - 1.001 ? h - 1.001 : sy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const tx = sx - x0, ty = sy - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x0 + 1) * 4;
      const i01 = ((y0 + 1) * w + x0) * 4;
      const i11 = ((y0 + 1) * w + x0 + 1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const v = src[i00 + k] * (1 - tx) * (1 - ty) + src[i10 + k] * tx * (1 - ty)
          + src[i01 + k] * (1 - tx) * ty + src[i11 + k] * tx * ty;
        out[o + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
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
