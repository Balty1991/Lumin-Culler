/**
 * core/hslBands.ts
 * Reglaj pe game de culoare: nuanta, saturatia si luminozitatea, separat pe
 * fiecare familie de culoare din poza.
 *
 * E instrumentul dupa care un fotograf intreaba primul cand vede un editor:
 * "pot sa scad doar verdele?". Sliderul global de saturatie muta TOT — cerul,
 * pielea si iarba deodata — asa ca nu se poate folosi pentru mai nimic din ce
 * chiar vrea cineva sa faca ("frunzele prea tipatoare", "cerul spalacit",
 * "tenul prea galben"). Aici fiecare gama se misca singura.
 *
 * Fara DOM si fara canvas: primeste pixeli, ii schimba pe loc.
 */

export const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type BandKey = (typeof BANDS)[number];

/** Centrul fiecarei game pe cercul de nuante, in grade. */
const BAND_CENTER: Record<BandKey, number> = {
  red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 280, magenta: 320
};

export interface BandAdjust {
  /** Rotirea nuantei in interiorul gamei, -100..100 (≈ ±30°). */
  hue: number;
  /** Saturatia gamei, -100..100. -100 o scoate complet la gri. */
  saturation: number;
  /** Luminozitatea gamei, -100..100. */
  luminance: number;
}

export type HslBands = Partial<Record<BandKey, BandAdjust>>;

export const NEUTRAL_BAND: BandAdjust = { hue: 0, saturation: 0, luminance: 0 };

export function isNeutralBands(bands: HslBands | undefined): boolean {
  if (!bands) return true;
  return Object.values(bands).every(b => !b || (b.hue === 0 && b.saturation === 0 && b.luminance === 0));
}

/** Cat de departe sunt doua nuante pe cerc, in grade (0..180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Cat de mult apartine o nuanta fiecarei game.
 *
 * Trecerea e LINA, nu pe felii cu margini: cu praguri dure, un cer al carui
 * albastru aluneca incet spre turcoaz ar capata o dunga vizibila exact acolo
 * unde se schimba felia. Fiecare gama tine pana la `REACH` grade de centrul ei,
 * iar ponderile se suprapun la mijloc — asa cum se suprapun si culorile.
 */
const REACH = 45;
export function bandWeights(hueDeg: number): Record<BandKey, number> {
  const out = {} as Record<BandKey, number>;
  for (const band of BANDS) {
    const d = hueDistance(hueDeg, BAND_CENTER[band]);
    // cosinus ridicat: 1 in centru, 0 la margine, fara colt la trecere
    out[band] = d >= REACH ? 0 : Math.cos((d / REACH) * (Math.PI / 2)) ** 2;
  }
  return out;
}

/** RGB 0..255 -> HSL cu H in grade, S si L in 0..1. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let T = t;
  if (T < 0) T += 1;
  if (T > 1) T -= 1;
  if (T < 1 / 6) return p + (q - p) * 6 * T;
  if (T < 1 / 2) return q;
  if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
  return p;
}

/** HSL (H in grade) -> RGB 0..255. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const H = (((h % 360) + 360) % 360) / 360;
  return [
    Math.round(hueToRgb(p, q, H + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, H) * 255),
    Math.round(hueToRgb(p, q, H - 1 / 3) * 255)
  ];
}

/** Cat roteste nuanta un slider dus la capat. */
const MAX_HUE_SHIFT = 30;

/**
 * Aplica reglajele pe loc, peste pixelii dati.
 *
 * Pixelii aproape gri sunt lasati in pace: acolo nuanta e zgomot de rotunjire,
 * iar a-i muta ar produce pete colorate exact in zonele neutre (zapada, asfalt,
 * un perete alb) unde ochiul le vede cel mai usor.
 */
const GRAY_THRESHOLD = 0.04;

export function applyHslBands(d: Uint8ClampedArray, bands: HslBands): void {
  if (isNeutralBands(bands)) return;
  // Pregatim o singura data lista gamelor care chiar au ceva de facut.
  const active = BANDS.filter(b => {
    const v = bands[b];
    return v && (v.hue !== 0 || v.saturation !== 0 || v.luminance !== 0);
  });
  if (!active.length) return;

  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (s < GRAY_THRESHOLD) continue;

    const w = bandWeights(h);
    let dh = 0, ds = 0, dl = 0, total = 0;
    for (const band of active) {
      const weight = w[band];
      if (weight <= 0) continue;
      const v = bands[band]!;
      dh += weight * (v.hue / 100) * MAX_HUE_SHIFT;
      ds += weight * (v.saturation / 100);
      dl += weight * (v.luminance / 100);
      total += weight;
    }
    if (total <= 0) continue;

    // Saturatia se inmulteste, nu se aduna: pe o culoare deja slaba, un plus
    // aditiv ar fi umflat-o mai tare decat pe una vie, si tocmai zonele
    // aproape neutre ar fi sarit primele in ochi.
    const ns = Math.max(0, Math.min(1, s * (1 + ds)));
    const nl = Math.max(0, Math.min(1, l + dl * 0.5));
    const [r, g, b] = hslToRgb(h + dh, ns, nl);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}
