/**
 * core/selectiveEdit.ts
 * Editare SELECTIVA prin puncte de control — instrumentul dupa care se
 * recunoaste Snapseed (acolo se numeste "Selective", tehnologia U Point).
 * Ideea: pui un punct pe cer si ii cobori luminozitatea; cerul se intuneca,
 * dar chipul de dedesubt, care are cu totul alta culoare, nu se atinge — fara
 * sa fi desenat nicio masca cu degetul.
 *
 * Masca unui punct e produsul a doua lucruri, si asta e tot secretul:
 *   1. cat de APROAPE e pixelul de punct (o cadere lina pana la raza aleasa);
 *   2. cat de ASEMANATOR e la culoare cu pixelul de sub punct.
 * Al doilea factor e cel care face selectia sa "se muleze" pe obiect: doi
 * pixeli la aceeasi distanta, unul albastru de cer si unul roz de piele, nu
 * primesc aceeasi corectie.
 *
 * Cost: bucla NU trece prin toata imaginea, ci doar prin dreptunghiul care
 * incadreaza raza punctului (vezi boundsFor) — in afara lui masca e exact
 * zero, deci acei pixeli nu au ce sa primeasca. Un punct cu raza mica pe o
 * poza mare costa cateva zeci de mii de pixeli, nu milioane.
 */

export interface ControlPoint {
  /** Identitate stabila, ca reordonarea sau stergerea sa nu incurce selectia din UI. */
  id: string;
  /** Pozitia in imagine, 0..1. */
  x: number;
  y: number;
  /** Raza, ca fractie din latura mai MARE a imaginii — ca sa insemne acelasi lucru pe portret si pe peisaj. */
  radius: number;
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -100..100 */
  saturation: number;
  /** Contrast local (texturi) — -100..100. In Snapseed se numeste "structura". */
  structure: number;
}

export const DEFAULT_CONTROL_RADIUS = 0.22;
export const MIN_CONTROL_RADIUS = 0.05;
export const MAX_CONTROL_RADIUS = 1.2;
/** Peste atatea puncte, si ecranul, si bugetul de timp per cadru se aglomereaza fara castig real. */
export const MAX_CONTROL_POINTS = 6;

/**
 * Cat de diferita poate fi culoarea unui pixel fata de cea de sub punct
 * inainte sa iasa complet din selectie. Valorile sunt in unitati 0..255.
 * Luminanta e mai permisiva decat cromatica DELIBERAT: un cer are aceeasi
 * culoare dar se inchide spre zenit, si trebuie sa ramana o singura selectie.
 */
const LUM_TOLERANCE = 90;
const CHROMA_TOLERANCE = 60;

export function createControlPoint(x: number, y: number, id: string): ControlPoint {
  return { id, x, y, radius: DEFAULT_CONTROL_RADIUS, brightness: 0, contrast: 0, saturation: 0, structure: 0 };
}

/** true daca punctul nu schimba nimic — nu merita nici calculat, nici salvat. */
export function isNeutralControlPoint(p: ControlPoint): boolean {
  return p.brightness === 0 && p.contrast === 0 && p.saturation === 0 && p.structure === 0;
}

/** true daca niciun punct nu are efect (sau nu exista niciunul). */
export function hasNoControlPoints(points: ControlPoint[] | undefined): boolean {
  return !points || points.length === 0 || points.every(isNeutralControlPoint);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Cadere lina 1 → 0 pe intervalul 0..1 (smoothstep inversat) — fara muchie vizibila la marginea razei. */
function falloff(t: number): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  const u = 1 - t;
  return u * u * (3 - 2 * u);
}

/**
 * Dreptunghiul de pixeli pe care punctul ii poate atinge. Exportat ca sa fie
 * verificabil direct: garantia ca in afara lui masca e zero e chiar motivul
 * pentru care bucla se poate limita la el.
 */
export function boundsFor(point: ControlPoint, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  const radiusPx = point.radius * Math.max(width, height);
  const cx = point.x * width, cy = point.y * height;
  return {
    x0: Math.max(0, Math.floor(cx - radiusPx)),
    y0: Math.max(0, Math.floor(cy - radiusPx)),
    x1: Math.min(width, Math.ceil(cx + radiusPx)),
    y1: Math.min(height, Math.ceil(cy + radiusPx))
  };
}

/** Culoarea de referinta: pixelul de sub punct (folosita ca ancora de similaritate). */
function referenceColor(d: Uint8ClampedArray, width: number, height: number, point: ControlPoint): { r: number; g: number; b: number } {
  const px = Math.min(width - 1, Math.max(0, Math.round(point.x * width)));
  const py = Math.min(height - 1, Math.max(0, Math.round(point.y * height)));
  const i = (py * width + px) * 4;
  return { r: d[i], g: d[i + 1], b: d[i + 2] };
}

/**
 * Masca unui punct, ca valori 0..1, pe dreptunghiul intors de boundsFor.
 * Separata de aplicare ca sa poata fi verificata direct (si desenata, daca
 * vreodata se adauga un mod "arata selectia").
 */
export function computeControlMask(
  d: Uint8ClampedArray, width: number, height: number, point: ControlPoint
): { mask: Float32Array; x0: number; y0: number; x1: number; y1: number } {
  const b = boundsFor(point, width, height);
  const w = Math.max(0, b.x1 - b.x0), h = Math.max(0, b.y1 - b.y0);
  const mask = new Float32Array(w * h);
  if (w === 0 || h === 0) return { mask, ...b };

  const ref = referenceColor(d, width, height, point);
  const refLum = 0.299 * ref.r + 0.587 * ref.g + 0.114 * ref.b;
  const refCr = ref.r - refLum, refCb = ref.b - refLum;
  const radiusPx = point.radius * Math.max(width, height);
  const cx = point.x * width, cy = point.y * height;

  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / radiusPx;
      const spatial = falloff(dist);
      if (spatial <= 0) continue;

      const i = (y * width + x) * 4;
      const r = d[i], g = d[i + 1], bl = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
      const dLum = Math.abs(lum - refLum) / LUM_TOLERANCE;
      const cr = r - lum, cb = bl - lum;
      const dChroma = Math.sqrt((cr - refCr) * (cr - refCr) + (cb - refCb) * (cb - refCb)) / CHROMA_TOLERANCE;
      const similar = falloff(Math.min(1, dLum)) * falloff(Math.min(1, dChroma));
      if (similar <= 0) continue;

      mask[(y - b.y0) * w + (x - b.x0)] = spatial * similar;
    }
  }
  return { mask, ...b };
}

/**
 * Aplica un punct peste bufferul RGBA, la fata locului.
 * `blurred` e o versiune neclara a luminantei intregii imagini, necesara doar
 * pentru "structura" (contrast local) — se calculeaza O SINGURA DATA de catre
 * apelant si se imparte intre puncte, ca sa nu o refacem pentru fiecare.
 */
export function applyControlPoint(
  d: Uint8ClampedArray, width: number, height: number, point: ControlPoint, blurredLum?: Float32Array
): void {
  if (isNeutralControlPoint(point)) return;
  const { mask, x0, y0, x1, y1 } = computeControlMask(d, width, height, point);
  const w = x1 - x0;
  if (w <= 0) return;

  const bright = (point.brightness / 100) * 70;      // pana la ±70 pe 0..255
  const contrast = 1 + (point.contrast / 100) * 0.6; // pana la ±60% contrast local
  const sat = 1 + point.saturation / 100;
  const structure = (point.structure / 100) * 0.9;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const m = mask[(y - y0) * w + (x - x0)];
      if (m <= 0.001) continue;
      const i = (y * width + x) * 4;
      let r = d[i], g = d[i + 1], b = d[i + 2];

      if (bright !== 0) { r += bright * m; g += bright * m; b += bright * m; }
      if (contrast !== 1) {
        r = 128 + (r - 128) * (1 + (contrast - 1) * m);
        g = 128 + (g - 128) * (1 + (contrast - 1) * m);
        b = 128 + (b - 128) * (1 + (contrast - 1) * m);
      }
      if (sat !== 1) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const k = 1 + (sat - 1) * m;
        r = lum + (r - lum) * k;
        g = lum + (g - lum) * k;
        b = lum + (b - lum) * k;
      }
      if (structure !== 0 && blurredLum) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const delta = (lum - blurredLum[y * width + x]) * structure * m;
        r += delta; g += delta; b += delta;
      }

      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
  }
}
