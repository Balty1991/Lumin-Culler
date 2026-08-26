/**
 * core/styleLook.ts
 *
 * "Stil" — celalalt buton din editor, langa Auto.
 *
 * Cele doua fac lucruri DIFERITE, si asta e toata ideea. Auto e un CORECTOR:
 * masoara ce e gresit (expunere pe fata, contralumina, dominanta de culoare,
 * capete arse) si repara doar atat. Pe o poza de telefon, deja prelucrata de
 * procesorul camerei, raspunsul lui corect e adesea "nu prea am ce repara" —
 * si atunci omul apasa Auto si nu vede mai nimic. Reclamat exact asa:
 * "functia auto nu aduce mari imbunatatiri".
 *
 * Ce lipsea nu era o corectie, ci un LOOK: claritate locala, ceva contrast,
 * culoare putin mai vie, negrul asezat. Aia nu e o eroare de reparat, e o
 * alegere de gust — de-aia sta pe un buton separat, nu ascunsa in Auto, unde
 * ar fi schimbat rezultatul fiecarei poze fara ca nimeni sa fi cerut-o.
 *
 * Valorile nu sunt fixe: se MASOARA din poza. Una deja contrastanta si vie
 * primeste putin, una plata si ceteasa primeste mult. Un stil care adauga
 * mereu aceleasi +25 ar arde exact pozele care n-au nevoie de el.
 */

/** Cat se adauga peste ajustarile curente. Numere, nu absoluturi. */
export interface StyleLook {
  clarity: number;
  contrast: number;
  saturation: number;
  blacks: number;
}

export const NO_STYLE_LOOK: StyleLook = { clarity: 0, contrast: 0, saturation: 0, blacks: 0 };

/** Esantionaj: acelasi pas ca in computeAutoContrast, din aceleasi motive. */
const STEP = 4;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Interpolare liniara intre doua perechi (x0,y0)-(x1,y1), cu capetele fixe. */
function mapRange(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return clamp(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0), Math.min(y0, y1), Math.max(y0, y1));
}

/**
 * Trei masuratori pe imaginea micsorata, fiecare cu rolul ei:
 *
 * - `microContrast` — media diferentei de luminanta intre pixeli VECINI. Mica
 *   inseamna cadru plat sau cetos (ceata, lumina dura difuza, geam), si acolo
 *   claritatea chiar face diferenta. Mare inseamna textura deja prezenta, si
 *   atunci claritatea doar produce halouri.
 * - `saturation` — cat de departe de gri sunt culorile. Sub un prag, un plus
 *   de culoare se citeste ca "viu"; peste el, ca "tipator".
 * - `blackPoint` — percentila 1% de luminanta. Cand nu coboara la zero, poza
 *   pare spalata, si asezarea negrului e ce ii da adancime.
 */
export function measureStyleSignals(img: ImageData): { microContrast: number; saturation: number; blackPoint: number } {
  const { data, width, height } = img;
  let microSum = 0;
  let microCount = 0;
  let satSum = 0;
  let satCount = 0;
  const hist = new Uint32Array(256);
  let lumCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x += STEP) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const lumNext = 0.299 * data[i + 4] + 0.587 * data[i + 5] + 0.114 * data[i + 6];
      microSum += Math.abs(lum - lumNext);
      microCount++;

      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      satSum += max === 0 ? 0 : (max - min) / max;
      satCount++;

      hist[Math.round(clamp(lum, 0, 255))]++;
      lumCount++;
    }
  }

  let cum = 0;
  let blackPoint = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (lumCount > 0 && cum / lumCount >= 0.01) { blackPoint = v; break; }
  }

  return {
    microContrast: microCount ? microSum / microCount : 0,
    saturation: satCount ? satSum / satCount : 0,
    blackPoint
  };
}

/**
 * Pragurile. Sunt alegeri de gust, deci stau explicit aici, cu numere pe care
 * le poate misca oricine, nu imprastiate prin formule.
 *
 * Plafoanele sunt deliberat modeste. Un stil se poate aplica de doua ori (se
 * aduna peste ce e deja pus), iar cine vrea mai mult are sliderele dedesubt —
 * pe cand un stil prea tare nu se poate lua inapoi decat cu Reseteaza, care
 * arunca si restul editarii.
 */
const FLAT_MICRO_CONTRAST = 3;    // sub asta: cadru vizibil plat/cetos
const CRISP_MICRO_CONTRAST = 14;  // peste asta: textura e deja acolo
const CLARITY_ON_FLAT = 32;
const CLARITY_ON_CRISP = 8;

const DULL_SATURATION = 0.10;
const RICH_SATURATION = 0.38;
const VIBRANCE_ON_DULL = 18;
const VIBRANCE_ON_RICH = 3;

const LIFTED_BLACK = 22;          // peste asta, negrul nu ajunge la zero
const BLACKS_MAX_DEEPENING = -14;
const BLACKS_MIN_DEEPENING = -3;

const CONTRAST_ON_FLAT = 12;
const CONTRAST_ON_CRISP = 4;

export function computeStyleLook(img: ImageData): StyleLook {
  const { microContrast, saturation, blackPoint } = measureStyleSignals(img);
  return {
    clarity: Math.round(mapRange(microContrast, FLAT_MICRO_CONTRAST, CRISP_MICRO_CONTRAST, CLARITY_ON_FLAT, CLARITY_ON_CRISP)),
    contrast: Math.round(mapRange(microContrast, FLAT_MICRO_CONTRAST, CRISP_MICRO_CONTRAST, CONTRAST_ON_FLAT, CONTRAST_ON_CRISP)),
    saturation: Math.round(mapRange(saturation, DULL_SATURATION, RICH_SATURATION, VIBRANCE_ON_DULL, VIBRANCE_ON_RICH)),
    // Un negru deja asezat primeste doar o atingere; unul spalat, mai mult.
    blacks: Math.round(
      blackPoint <= LIFTED_BLACK
        ? BLACKS_MIN_DEEPENING
        : mapRange(blackPoint, LIFTED_BLACK, 90, BLACKS_MIN_DEEPENING, BLACKS_MAX_DEEPENING)
    )
  };
}

/**
 * Stilul se ADUNA peste ce e deja pus, nu inlocuieste. Cine a reglat ceva de
 * mana nu are de ce sa piarda reglajul fiindca a apasat "Stil" — iar cine
 * apasa de doua ori chiar vrea mai mult, si il primeste, pana la capatul
 * sliderului.
 */
export function addStyleLook<T extends { clarity?: number; contrast: number; saturation: number; blacks?: number }>(
  current: T,
  look: StyleLook
): T {
  return {
    ...current,
    clarity: clamp((current.clarity ?? 0) + look.clarity, -100, 100),
    contrast: clamp(current.contrast + look.contrast, -100, 100),
    saturation: clamp(current.saturation + look.saturation, -100, 100),
    blacks: clamp((current.blacks ?? 0) + look.blacks, -100, 100)
  };
}
