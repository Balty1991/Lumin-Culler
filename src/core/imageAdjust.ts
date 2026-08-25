/**
 * core/imageAdjust.ts
 * Ajustari de baza non-destructive (expunere/contrast/saturatie/temperatura/
 * tinta/highlights/shadows) — nu modifica niciodata blob-ul original sau
 * preview-ul stocat, doar re-deseneaza pe un canvas la cerere (DetailView,
 * export). Valorile se salveaza pe PhotoRecord.edits (core/db.ts) si se pot
 * reseta oricand fara pierdere de calitate, exact ca develop module-ul dintr-un
 * soft de catalogare (Lightroom/Capture One), dar mult mai restrans in scop.
 */

import { buildChannelLuts, hasNoCurves, type PhotoCurves, type CurvePoint } from './toneCurve';
import { applyControlPoint, hasNoControlPoints, isNeutralControlPoint, type ControlPoint } from './selectiveEdit';
import { applyHslBands, isNeutralBands, type HslBands } from './hslBands';
import { applyHealStrokes, type HealStroke } from './spotHeal';

export interface EditAdjustments {
  exposure: number;    // -100..100
  contrast: number;    // -100..100
  saturation: number;  // -100..100
  temperature: number; // -100..100 (rece <-> cald)
  tint: number;        // -100..100 (verde <-> magenta)
  highlights: number;  // -100..100
  shadows: number;     // -100..100
  /**
   * Capetele scalei tonale, separat de highlights/shadows — perechea care
   * lipsea ca sa existe control tonal complet.
   *
   * Diferenta nu e de gust: `highlights`/`shadows` COMPRIMA cele doua zone
   * (recupereaza detaliu dintr-un cer ars sau dintr-o umbra inecata), pe cand
   * `whites`/`blacks` MUTA CAPETELE — adica decid unde incepe albul curat si
   * unde incepe negrul curat. De asta o poza "spalata" nu se repara cu shadows:
   * n-are nevoie de mai mult detaliu in umbre, ci de un punct de negru.
   * -100..100. Absente = 0, ca la inregistrarile dinaintea acestui camp.
   */
  whites?: number;
  blacks?: number;
  /** Indreptare unghi mic (grade) — vezi computeAutoStraighten. Absent/0 = fara rotatie. Clamped la ±MAX_ROTATION_DEG. */
  rotationDeg?: number;
  /**
   * Recadrare normalizata (0..1), in spatiul imaginii ORIGINALE — vezi
   * computeAutoCrop. Absent = cadrul intreg, nemodificat. Nu schimba
   * rezolutia finala a exportului (canvas-ul de iesire ramane la dimensiunea
   * originala) — doar CE portiune a cadrului se vede, redesenata la aceeasi
   * rezolutie, nu o decupare care micsoreaza fisierul.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /** Accentuare margini (unsharp simplu, kernel 3x3) — 0..100. Absent = 0, la fel ca inregistrarile vechi din Dexie dinainte de acest camp. */
  sharpen?: number;
  /** Contrast local ("claritate" stil Lightroom) — -100..100; negativ inmoaie, pozitiv accentueaza texturile de detaliu fara sa schimbe expunerea globala. */
  clarity?: number;
  /** Reducere zgomot (blend cu o varianta usor difuzata) — 0..100. */
  noiseReduction?: number;
  /** Intunecarea/luminarea colturilor — -100..100. Negativ = colturi mai deschise. */
  vignette?: number;
  /** Reglaj pe game de culoare (nuanta/saturatie/luminozitate per familie) — vezi core/hslBands.ts. Absent = neatins. */
  hsl?: HslBands;
  /** Curbele tonale (master + R/G/B) — vezi core/toneCurve.ts. Absent = liniare. */
  curves?: PhotoCurves;
  /** Punctele de control selective — vezi core/selectiveEdit.ts. Absent = niciunul. */
  controlPoints?: ControlPoint[];
  /** Tusele de vindecare, in coordonate 0..1 ale imaginii ORIGINALE — vezi core/spotHeal.ts. */
  heal?: HealStroke[];
}

export const NEUTRAL_ADJUSTMENTS: EditAdjustments = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, rotationDeg: 0,
  whites: 0, blacks: 0, sharpen: 0, clarity: 0, noiseReduction: 0, vignette: 0
};

/**
 * Cheile NUMERICE ale unei ajustari — singurele care au slider si singurele
 * comparabile direct cu 0. `crop`, `curves`, `controlPoints` si `heal` sunt
 * structuri, nu numere: fiecare are propria verificare in isNeutral().
 * Tipul e exportat ca sa nu mai fie nevoie ca UI-ul sa repete lista de excluderi
 * (si sa o uite la urmatorul instrument adaugat — exact ce s-a intamplat).
 */
export type NumericAdjustmentKey = Exclude<keyof EditAdjustments, 'crop' | 'curves' | 'controlPoints' | 'heal' | 'hsl'>;
const ADJUSTMENT_KEYS = Object.keys(NEUTRAL_ADJUSTMENTS) as NumericAdjustmentKey[];

/**
 * true daca nu exista nicio ajustare — folosit pentru badge-ul "editat" si
 * starea butonului Reseteaza. Pe langa slidere si crop, verifica si cele trei
 * instrumente care nu sunt numere: curbele, punctele de control si tusele de
 * vindecare. Un punct de control PUS dar neatins inca (toate valorile 0) nu
 * conteaza ca editare — altfel simpla deschidere a instrumentului ar marca
 * poza drept editata.
 */
export function isNeutral(a: EditAdjustments | undefined): boolean {
  if (!a) return true;
  return ADJUSTMENT_KEYS.every(k => (a[k] ?? 0) === 0)
    && !a.crop
    && hasNoCurves(a.curves)
    && hasNoControlPoints(a.controlPoints)
    && isNeutralBands(a.hsl)
    && !a.heal?.length;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const MAX_ROTATION_DEG = 8;

/**
 * Deseneaza doar geometria (recadrare + indreptare unghi mic), fara filtrele
 * de culoare — separat de drawAdjusted() ca sa ramana usor de testat/rationat
 * independent. `sourceWidth`/`sourceHeight` sunt dimensiunile REALE ale lui
 * `source` (folosite pentru a converti fractiunile de crop, definite in
 * spatiul imaginii originale, in pixeli de citit din `source`); `destWidth`/
 * `destHeight` sunt dimensiunea canvas-ului de iesire — pot diferi acum
 * (EditPanel deseneaza un preview plafonat la EDIT_PREVIEW_MAX_SIDE dintr-un
 * imgEl la rezolutie completa). Bug real raportat de utilizator, dupa
 * plafonarea rezolutiei preview-ului: cand cele doua dimensiuni difera si
 * exista un crop, folosirea lui destWidth/destHeight (mult mai mici) pentru a
 * citi din `source` (la rezolutie completa) facea sa se citeasca doar un
 * colt minuscul din imagine — un preview aparent "spart", zoomat gresit intr-o
 * portiune mica si neclara a cadrului, exact ca in captura primita.
 */
function drawGeometry(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, destWidth: number, destHeight: number, a: EditAdjustments): void {
  const rotationDeg = clampRange(a.rotationDeg ?? 0, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
  const crop = a.crop;
  const sx = crop ? crop.x * sourceWidth : 0;
  const sy = crop ? crop.y * sourceHeight : 0;
  const sw = crop ? crop.width * sourceWidth : sourceWidth;
  const sh = crop ? crop.height * sourceHeight : sourceHeight;

  if (rotationDeg === 0) {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, destWidth, destHeight);
    return;
  }
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  // scala minima ca dreptunghiul rotit sa tot acopere fereastra destWidth x
  // destHeight — fara ea, colturile ar ramane goale/transparente dupa o mica
  // indreptare.
  const safetyScale = Math.max((sw * cos + sh * sin) / sw, (sw * sin + sh * cos) / sh);
  ctx.save();
  ctx.translate(destWidth / 2, destHeight / 2);
  ctx.rotate(rad);
  ctx.scale(safetyScale, safetyScale);
  ctx.drawImage(source, sx, sy, sw, sh, -destWidth / 2, -destHeight / 2, destWidth, destHeight);
  ctx.restore();
}

function clampRange(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampIdx(i: number, size: number): number {
  return i < 0 ? 0 : i >= size ? size - 1 : i;
}

/**
 * Cache de UN singur "slot" (nu pe marime, ca sa nu creasca nelimitat cat timp
 * ContactSheet/Workspace redeseneaza multe poze de dimensiuni diferite) pentru
 * cele 4 buffere Float32 folosite de reducerea de zgomot/claritate/sharpen mai
 * jos — evita realocarea a ~50MB (2048x1536, cazul obisnuit — vezi
 * PREVIEW_MAX_SIDE din importPipeline.ts) la FIECARE cadru cat timp utilizatorul
 * trage un slider pe ACEEASI poza (cazul de departe cel mai frecvent). La
 * schimbarea dimensiunii (poza noua), buffer-ele vechi sunt pur si simplu
 * inlocuite, nu acumulate — presiune de GC marginala, nu o scurgere de memorie.
 * Sigur doar cat timp drawAdjusted ramane SINCRON si apelat dintr-un singur
 * thread (adevarat azi — niciun apel concurent posibil).
 */
let scratchSize = -1;
let scratch: Float32Array[] = [];
function getScratch(size: number): Float32Array[] {
  if (scratchSize !== size) {
    scratch = [new Float32Array(size), new Float32Array(size), new Float32Array(size), new Float32Array(size)];
    scratchSize = size;
  }
  return scratch;
}

/** Blur box separabil (orizontal apoi vertical) pe UN plan de canal, O(n) via suma culisanta — NU O(n * raza^2) cu bucla imbricata naiva. */
function boxBlurChannel(src: Float32Array, dst: Float32Array, temp: Float32Array, width: number, height: number, radius: number): void {
  const windowSize = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + clampIdx(x, width)];
    for (let x = 0; x < width; x++) {
      temp[row + x] = sum / windowSize;
      sum += src[row + clampIdx(x + radius + 1, width)] - src[row + clampIdx(x - radius, width)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += temp[clampIdx(y, height) * width + x];
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / windowSize;
      sum += temp[clampIdx(y + radius + 1, height) * width + x] - temp[clampIdx(y - radius, height) * width + x];
    }
  }
}

/**
 * Unsharp simplu, kernel 3x3 clasic (centru 1+4k, cei 4 vecini directi -k).
 * Citeste din `src`, scrie in `dst` — buffere SEPARATE, altfel vecinii deja
 * suprascrisi in aceeasi trecere ar strica rezultatul pixelilor urmatori.
 */
function applySharpenChannel(src: Float32Array, dst: Float32Array, width: number, height: number, k: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const up = src[clampIdx(y - 1, height) * width + x];
      const down = src[clampIdx(y + 1, height) * width + x];
      const left = src[y * width + clampIdx(x - 1, width)];
      const right = src[y * width + clampIdx(x + 1, width)];
      dst[idx] = src[idx] * (1 + 4 * k) - k * (up + down + left + right);
    }
  }
}

const NOISE_BLUR_RADIUS = 2;
const CLARITY_BLUR_RADIUS = 10;
/** Magnitudine maxima a delta-ului de claritate la ±100 — calibrata sa ramana un contrast local vizibil, nu o resolarizare agresiva. */
const CLARITY_MAX_STRENGTH = 0.6;
/** k maxim in kernelul de sharpen (vezi applySharpenChannel) la slider=100 — peste asta apar halouri vizibile in jurul muchiilor. */
const SHARPEN_MAX_K = 0.5;

/**
 * Reducere zgomot / claritate / accentuare — SINGURELE ajustari din acest
 * fisier care au nevoie de pixeli VECINI (nu doar transformare per-pixel
 * independenta), deci opereaza pe planuri de canal separate (Float32Array),
 * nu pe bufferul intretesut RGBA direct. Ordinea conteaza: reducere zgomot
 * INTAI (altfel am accentua exact zgomotul pe care tocmai l-am atenuat),
 * claritate apoi, sharpen ULTIMUL (pasul clasic de finisare intr-un pipeline
 * de editare foto).
 */
/** Exportata (nu doar folosita intern de drawAdjusted) ca sa fie testabila direct pe un Uint8ClampedArray construit manual, fara canvas real (jsdom nu il implementeaza). */
export function applyDetailPass(d: Uint8ClampedArray, width: number, height: number, a: EditAdjustments): void {
  const size = width * height;
  const r = new Float32Array(size), g = new Float32Array(size), b = new Float32Array(size);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { r[p] = d[i]; g[p] = d[i + 1]; b[p] = d[i + 2]; }

  const noiseAmt = clampRange((a.noiseReduction ?? 0) / 100, 0, 1);
  if (noiseAmt > 0) {
    const [rb, gb, bb, temp] = getScratch(size);
    boxBlurChannel(r, rb, temp, width, height, NOISE_BLUR_RADIUS);
    boxBlurChannel(g, gb, temp, width, height, NOISE_BLUR_RADIUS);
    boxBlurChannel(b, bb, temp, width, height, NOISE_BLUR_RADIUS);
    for (let p = 0; p < size; p++) {
      r[p] += (rb[p] - r[p]) * noiseAmt;
      g[p] += (gb[p] - g[p]) * noiseAmt;
      b[p] += (bb[p] - b[p]) * noiseAmt;
    }
  }

  const clarityAmt = (a.clarity ?? 0) / 100; // -1..1
  if (clarityAmt !== 0) {
    const [lum, lumBlur, temp] = getScratch(size);
    for (let p = 0; p < size; p++) lum[p] = 0.299 * r[p] + 0.587 * g[p] + 0.114 * b[p];
    boxBlurChannel(lum, lumBlur, temp, width, height, CLARITY_BLUR_RADIUS);
    const strength = clarityAmt * CLARITY_MAX_STRENGTH;
    for (let p = 0; p < size; p++) {
      const delta = (lum[p] - lumBlur[p]) * strength;
      r[p] += delta; g[p] += delta; b[p] += delta;
    }
  }

  const sharpenAmt = clampRange((a.sharpen ?? 0) / 100, 0, 1) * SHARPEN_MAX_K;
  if (sharpenAmt > 0) {
    const [rs, gs, bs] = getScratch(size);
    applySharpenChannel(r, rs, width, height, sharpenAmt);
    applySharpenChannel(g, gs, width, height, sharpenAmt);
    applySharpenChannel(b, bs, width, height, sharpenAmt);
    r.set(rs); g.set(gs); b.set(bs);
  }

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = clamp255(r[p]); d[i + 1] = clamp255(g[p]); d[i + 2] = clamp255(b[p]);
  }
}

/**
 * Conversia intre coordonatele CADRULUI INTREG (0..1, cum sunt memorate
 * punctele de control si tusele de vindecare) si coordonatele a ceea ce se
 * VEDE pe canvas dupa recadrare si indreptare.
 *
 * De ce doua sisteme si nu unul: daca punctele ar fi memorate direct in
 * coordonatele cadrului vizibil, o singura atingere a recadrarii le-ar muta pe
 * toate pe poza. Memorate in cadrul intreg, raman lipite de obiectul pe care
 * le-a pus fotograful, orice s-ar intampla cu decupajul dupa aceea.
 *
 * `destWidth`/`destHeight` intra in calcul doar pentru rotatie: `ctx.rotate`
 * lucreaza in pixelii canvas-ului, deci unghiul trebuie aplicat acolo, nu in
 * fractii.
 */
export function originalToCanvas(
  x: number, y: number, a: EditAdjustments, destWidth: number, destHeight: number
): { x: number; y: number } {
  const crop = a.crop;
  let u = crop ? (x - crop.x) / crop.width : x;
  let v = crop ? (y - crop.y) / crop.height : y;
  const rotationDeg = clampRange(a.rotationDeg ?? 0, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
  if (rotationDeg !== 0) {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const sw = crop ? crop.width : 1, sh = crop ? crop.height : 1;
    const safetyScale = Math.max(
      (sw * Math.abs(cos) + sh * Math.abs(sin)) / sw,
      (sw * Math.abs(sin) + sh * Math.abs(cos)) / sh
    );
    const du = (u - 0.5) * destWidth, dv = (v - 0.5) * destHeight;
    u = 0.5 + (safetyScale * (du * cos - dv * sin)) / destWidth;
    v = 0.5 + (safetyScale * (du * sin + dv * cos)) / destHeight;
  }
  return { x: u, y: v };
}

/** Inversa lui originalToCanvas — pentru o atingere pe canvas, unde cade in cadrul intreg. */
export function canvasToOriginal(
  x: number, y: number, a: EditAdjustments, destWidth: number, destHeight: number
): { x: number; y: number } {
  let u = x, v = y;
  const crop = a.crop;
  const rotationDeg = clampRange(a.rotationDeg ?? 0, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
  if (rotationDeg !== 0) {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const sw = crop ? crop.width : 1, sh = crop ? crop.height : 1;
    const safetyScale = Math.max(
      (sw * Math.abs(cos) + sh * Math.abs(sin)) / sw,
      (sw * Math.abs(sin) + sh * Math.abs(cos)) / sh
    );
    const du = (u - 0.5) * destWidth / safetyScale, dv = (v - 0.5) * destHeight / safetyScale;
    u = 0.5 + (du * cos + dv * sin) / destWidth;
    v = 0.5 + (-du * sin + dv * cos) / destHeight;
  }
  if (crop) { u = crop.x + u * crop.width; v = crop.y + v * crop.height; }
  return { x: u, y: v };
}

/**
 * Cat de mult "creste" un obiect cand o portiune din cadru e intinsa peste tot
 * canvas-ul — folosit ca sa scaleze raza unui punct de control odata cu
 * recadrarea. E media celor doua axe, si asta e o aproximare asumata: pe o
 * recadrare care schimba raportul, un cerc devine strict vorbind o elipsa, iar
 * noi il tinem cerc. Diferenta e sub pragul vizibil la recadrarile obisnuite,
 * iar alternativa (raza pe fiecare axa) ar complica si datele memorate, si
 * manevrarea din UI, pentru un castig pe care nu-l vede nimeni.
 */
export function cropRadiusScale(a: EditAdjustments): number {
  const crop = a.crop;
  if (!crop) return 1;
  return 2 / (crop.width + crop.height);
}

/**
 * Canvas de lucru pentru vindecare, pastrat intre apeluri (acelasi motiv ca
 * `scratch` de mai sus: EditPanel redeseneaza la fiecare cadru cat timp se
 * trage un slider, si un canvas nou per cadru ar da de lucru degeaba lui GC).
 */
let healCanvas: HTMLCanvasElement | null = null;
/**
 * Ce contine `healCanvas` in acest moment. Fara asta, fiecare cadru al unui
 * drag de slider redesena imaginea SURSA intreaga (pana la 2048px), o citea cu
 * getImageData si o vindeca din nou — desi nici sursa, nici tusele nu se
 * schimbasera. Vindecarea depinde EXCLUSIV de imagine si de tuse, deci
 * rezultatul se poate pastra pana cand una dintre ele chiar se schimba.
 */
let healCacheKey: { source: CanvasImageSource; strokes: string; width: number; height: number } | null = null;

/**
 * Aplica tusele de vindecare pe o COPIE a sursei si intoarce canvas-ul
 * rezultat, ca sa fie desenat mai departe in locul imaginii originale.
 *
 * Se intampla INAINTE de geometrie, si asta e o decizie, nu o intamplare:
 * tusele sunt memorate in coordonate 0..1 ale cadrului INTREG. Daca ar fi
 * aplicate dupa recadrare/indreptare, aceleasi coordonate ar cadea in alt
 * loc, si o pata reparata s-ar "muta" pe poza in clipa in care utilizatorul
 * atinge crop-ul. Asa, tusele raman legate de poza, nu de cadrul curent.
 *
 * Intoarce `null` cand nu e nimic de vindecat sau cand nu exista canvas
 * (jsdom in teste) — apelantul deseneaza atunci sursa originala.
 */
function healedSource(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, strokes: HealStroke[]): CanvasImageSource | null {
  if (!strokes.length || typeof document === 'undefined') return null;
  const strokeKey = JSON.stringify(strokes);
  if (healCanvas && healCacheKey
    && healCacheKey.source === source && healCacheKey.strokes === strokeKey
    && healCacheKey.width === sourceWidth && healCacheKey.height === sourceHeight) {
    return healCanvas;
  }
  if (!healCanvas) healCanvas = document.createElement('canvas');
  healCanvas.width = sourceWidth;
  healCanvas.height = sourceHeight;
  const hctx = healCanvas.getContext('2d', { willReadFrequently: true });
  if (!hctx) return null;
  hctx.clearRect(0, 0, sourceWidth, sourceHeight);
  hctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const img = hctx.getImageData(0, 0, sourceWidth, sourceHeight);
  applyHealStrokes(img.data, sourceWidth, sourceHeight, strokes);
  hctx.putImageData(img, 0, 0);
  healCacheKey = { source, strokes: strokeKey, width: sourceWidth, height: sourceHeight };
  return healCanvas;
}

/**
 * Deseneaza `source` pe canvas-ul lui `ctx` (dimensiune width x height) cu
 * ajustarile aplicate — geometrie (recadrare/indreptare) + culoare. Expunerea/
 * contrastul/saturatia trec prin ctx.filter (accelerat de browser);
 * temperatura/tinta/highlights/shadows/reducere-zgomot/claritate/sharpen
 * necesita un pixel-pass suplimentar (getImageData/putImageData), sarit
 * complet cand sunt toate neutre — cazul cel mai comun (doar primele 3
 * ajustate) ramane la fel de rapid ca un simplu drawImage.
 *
 * `sourceWidth`/`sourceHeight` (dimensiunea REALA a lui `source`) si
 * `width`/`height` (dimensiunea canvas-ului de iesire) pot diferi — vezi
 * comentariul de la drawGeometry despre bug-ul de crop gresit calculat cand
 * cele doua nu mai coincid (EditPanel plafoneaza rezolutia preview-ului).
 */
export function drawAdjusted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  a: EditAdjustments
): void {
  const brightness = 1 + a.exposure / 100;
  const contrast = 1 + a.contrast / 100;
  const saturate = 1 + a.saturation / 100;
  const healed = a.heal?.length ? healedSource(source, sourceWidth, sourceHeight, a.heal) : null;
  ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
  drawGeometry(ctx, healed ?? source, sourceWidth, sourceHeight, width, height, a);
  ctx.filter = 'none';

  const hasColorShift = a.temperature !== 0 || a.tint !== 0 || a.highlights !== 0 || a.shadows !== 0
    || (a.whites ?? 0) !== 0 || (a.blacks ?? 0) !== 0;
  const hasDetailPass = (a.sharpen ?? 0) !== 0 || (a.clarity ?? 0) !== 0 || (a.noiseReduction ?? 0) !== 0;
  const luts = buildChannelLuts(a.curves);
  const activePoints = (a.controlPoints ?? []).filter(p => !isNeutralControlPoint(p));
  const vignette = a.vignette ?? 0;
  const hasHsl = !isNeutralBands(a.hsl);
  if (!hasColorShift && !hasDetailPass && !luts && activePoints.length === 0 && vignette === 0 && !hasHsl) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;

  if (hasColorShift) {
    const tempShift = (a.temperature / 100) * 40;  // pana la ±40 pe canalele R/B (cald/rece)
    const tintShift = (a.tint / 100) * 40;         // pana la ±40 pe G vs R+B (verde/magenta)
    const highlightAmt = (a.highlights / 100) * 60;
    const shadowAmt = (a.shadows / 100) * 60;
    // Capetele: ponderi care cresc spre extremele scalei, nu spre mijloc ca la
    // highlights/shadows. Exponentul 3 le tine departe de tonurile medii —
    // altfel "punctul de negru" ar intuneca si fetele, nu doar umbrele.
    const whiteAmt = ((a.whites ?? 0) / 100) * 55;
    const blackAmt = ((a.blacks ?? 0) / 100) * 55;
    const hasToneShift = highlightAmt !== 0 || shadowAmt !== 0 || whiteAmt !== 0 || blackAmt !== 0;

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r += tempShift - tintShift / 2;
      b -= tempShift + tintShift / 2;
      g += tintShift;

      if (hasToneShift) {
        // luminanta inainte de shift-ul de temperatura/tinta ar fi mai corecta, dar
        // diferenta e imperceptibila la magnitudinea shift-urilor de mai sus —
        // preferam un singur pass peste pixel in loc de doua
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const hiWeight = Math.max(0, (lum - 128) / 127);
        const shWeight = Math.max(0, (128 - lum) / 128);
        const t = Math.max(0, Math.min(1, lum / 255));
        const whiteWeight = t * t * t;
        const blackWeight = (1 - t) * (1 - t) * (1 - t);
        const delta = highlightAmt * hiWeight + shadowAmt * shWeight
          + whiteAmt * whiteWeight + blackAmt * blackWeight;
        r += delta; g += delta; b += delta;
      }

      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
  }

  // Reglajul pe game de culoare vine DUPA shift-ul global de temperatura/tinta
  // (acela muta toate culorile deodata, deci trebuie sa se fi asezat inainte de
  // a decide ce gama e fiecare pixel) si INAINTE de curbe: curbele lucreaza pe
  // tonuri si trebuie sa vada culorile deja alese.
  if (hasHsl) applyHslBands(d, a.hsl!);

  // Curbele: trei citiri din tablou per pixel, indiferent cate curbe a desenat
  // utilizatorul — toata compunerea s-a facut deja in buildChannelLuts.
  if (luts) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = luts.r[d[i]];
      d[i + 1] = luts.g[d[i + 1]];
      d[i + 2] = luts.b[d[i + 2]];
    }
  }

  // Punctele de control. Luminanta neclara (necesara doar pentru "structura")
  // se calculeaza O SINGURA DATA si se imparte intre puncte — altfel fiecare
  // punct ar reface aceeasi neclaritate pe toata imaginea.
  if (activePoints.length) {
    let blurredLum: Float32Array | undefined;
    if (activePoints.some(p => p.structure !== 0)) {
      const size = width * height;
      const [lum, lumBlur, temp] = getScratch(size);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      boxBlurChannel(lum, lumBlur, temp, width, height, CLARITY_BLUR_RADIUS);
      // `lumBlur` e un buffer din scratch, refolosit — applyControlPoint doar il
      // citeste, si nimic altceva nu-l atinge pana la sfarsitul acestui pas,
      // deci nu are rost o copie noua la fiecare cadru.
      blurredLum = lumBlur;
    }
    // Punctele sunt memorate in cadrul INTREG; aici lucram pe cadrul VIZIBIL,
    // deci fiecare punct se converteste inainte de aplicare — vezi originalToCanvas.
    const radiusScale = cropRadiusScale(a);
    for (const point of activePoints) {
      const c = originalToCanvas(point.x, point.y, a, width, height);
      applyControlPoint(d, width, height, { ...point, x: c.x, y: c.y, radius: point.radius * radiusScale }, blurredLum);
    }
  }

  if (hasDetailPass) applyDetailPass(d, width, height, a);

  // Vinieta ULTIMA: e un efect de obiectiv, se aseaza peste imaginea finita,
  // nu peste una careia urmeaza sa i se mai schimbe contrastul.
  if (vignette !== 0) applyVignette(d, width, height, vignette);

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Intunecarea (sau luminarea) colturilor. Intensitatea creste cu patratul
 * distantei normalizate fata de centru — asa arata si caderea reala de lumina
 * a unui obiectiv, si de-aia o vinieta liniara se vede imediat ca "pusa".
 * Centrul ramane COMPLET neatins la orice intensitate: o vinieta care inchide
 * si mijlocul e doar o scadere de expunere prost deghizata.
 */
export function applyVignette(d: Uint8ClampedArray, width: number, height: number, amount: number): void {
  const cx = width / 2, cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const strength = (amount / 100) * 0.85;
  // pana la 45% din raza nu se intampla nimic — zona "curata" din centru
  const inner = 0.45;

  // Factorul depinde DOAR de distanta fata de centru, deci se poate tabela o
  // singura data si citi apoi din tablou, indexat direct cu distanta la PATRAT.
  // Asa dispar cele ~440.000 de radacini patrate pe cadru (una per pixel), care
  // erau cel mai scump lucru din tot pasul — masurat, nu presupus.
  const STEPS = 1024;
  const table = new Float32Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const dist = Math.sqrt(i / STEPS); // i/STEPS e distanta la PATRAT, normalizata
    table[i] = dist <= inner ? 1 : 1 - strength * ((dist - inner) / (1 - inner)) ** 2;
  }

  const invMax2 = 1 / (maxDist * maxDist);
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const t = (dx * dx + dy2) * invMax2;
      const factor = table[t >= 1 ? STEPS : (t * STEPS) | 0];
      if (factor === 1) continue;
      const i = (y * width + x) * 4;
      d[i] = clamp255(d[i] * factor);
      d[i + 1] = clamp255(d[i + 1] * factor);
      d[i + 2] = clamp255(d[i + 2] * factor);
    }
  }
}

/**
 * Semnalele pe care se bazeaza "editorul AI automat" — DELIBERAT aceleasi
 * campuri (si acelasi prag de 0.06 pentru clipping) pe care le foloseste deja
 * aiExplanationGenerator.ts (generateSuggestions) pentru "De ce acest scor" /
 * sugestiile de imbunatatire. Motivul e direct: o prima versiune deriva aceste
 * valori independent, dintr-o histograma re-esantionata pe un preview redus —
 * pe o poza reala, asta a produs corectii care contraziceau ce spunea deja
 * panoul de explicatii (si o corectie de balans de alb complet nefondata, vezi
 * mai jos), feedback direct: "parca mai mult a stricat decat a imbunatatit".
 * Reutilizand exact scorurile deja calculate (si deja AFISATE utilizatorului),
 * "Auto" nu mai poate contrazice explicatia AI-ului pentru acelasi cadru.
 */
export interface AutoAdjustSignals {
  /** AnalysisRecord.exposure (0..100) — 50 ~ echilibrat; acelasi camp folosit de generateSuggestions pentru "Cadrul e supraexpus/subexpus". undefined = poza neanalizata inca, nicio corectie de expunere. */
  exposureScore?: number;
  /** AnalysisRecord.highlightClipping (0..1) — fractiune de pixeli cu highlights arse. */
  highlightClipping?: number;
  /** AnalysisRecord.shadowClipping (0..1) — fractiune de pixeli cu umbre blocate. */
  shadowClipping?: number;
  /** AnalysisRecord.faceCount — vezi computeAutoCrop/computeAutoStraighten (recadrarea si indreptarea sunt mutual exclusive, gatate ca in generateSuggestions). */
  faceCount?: number;
  /** AnalysisRecord.faces — doar `.box` (normalizat [x,y,w,h]) e folosit, de aceea tipul local minimal (nu importam FaceInsight din core/db.ts — acest fisier ramane deliberat decuplat de restul schemei). */
  faces?: { box: [number, number, number, number] }[];
  /** AnalysisRecord.ruleOfThirds — vezi computeAutoCrop. */
  ruleOfThirds?: number;
  /** AnalysisRecord.horizonTiltDeg — vezi computeAutoStraighten. */
  horizonTiltDeg?: number;
  /** AnalysisRecord.colorHarmonyScore — vezi computeAutoSaturation. */
  colorHarmonyScore?: number;
  /**
   * AnalysisRecord.goldenHourDetected. Balansul de alb NU corecteaza la maxim o
   * lumina calda de seara: acolo dominanta portocalie e subiectul fotografiei,
   * nu un defect. Vezi computeAutoWhiteBalance.
   */
  goldenHourDetected?: boolean;
}

// ── Balans de alb automat ────────────────────────────────────────────────────
// Pana acum temperatura si tinta ramaneau pe 0 "fiindca nu exista semnal de
// incredere". Exista: pixelii. Metoda e cea clasica (gray-world aplicata pe un
// SUBSET robust — doar pixelii aproape neutri si bine expusi), nu pe tot cadrul:
// o gray-world naiva ar "corecta" o geaca rosie sau o rochie roz, adica ar
// scoate exact culoarea pentru care a fost facuta poza. Cu subsetul neutru,
// zapada albastruie (cazul din care a pornit cererea) se indreapta, iar un
// subiect colorat pe fundal neutru ramane neatins.

/** Sub atatia pixeli aproape-neutri nu exista referinta: mai bine nimic decat o ghiceala. */
const WB_MIN_NEUTRAL_FRACTION = 0.02;
/**
 * Cat de colorat poate fi un pixel ca sa mai conteze drept referinta de gri,
 * (max-min)/max. 0.28, nu 0.18: masurat pe cazul real, o dominanta calda de
 * interior (215,195,175) da 0.186 — la 0.18 exact pixelii ATINSI de dominanta
 * pe care trebuie s-o corectam erau exclusi, si functia tacea. O geaca rosie
 * sau o rochie roz raman mult peste prag (0.7-0.9), deci filtrul isi face in
 * continuare treaba: elimina subiectul colorat, nu grizul deviat.
 */
const WB_SATURATION_LIMIT = 0.28;
const WB_MIN_LUM = 55;
const WB_MAX_LUM = 245;
/** Plafon pe scara sliderelor (-100..100): o corectie mai mare de atat schimba poza, n-o repara. */
const WB_MAX_SHIFT = 30;
/** Cat din corectie se aplica pe o lumina de ora de aur — cat sa se calmeze dominanta, nu sa dispara. */
const WB_GOLDEN_HOUR_FACTOR = 0.35;

/**
 * Temperatura/tinta care aduc mediile R/G/B ale pixelilor aproape-neutri la
 * egalitate. Formulele de mai jos inverseaza EXACT ce face drawAdjusted:
 * temperatura muta R cu +t si B cu -t (t = temperature/100 * 40), deci diferenta
 * R-B se schimba cu 2t; tinta muta G cu +s si R,B cu -s/2 fiecare, deci
 * diferenta G-(R+B)/2 se schimba cu 1.5s.
 */
export function computeAutoWhiteBalance(
  img: ImageData,
  goldenHour = false,
  /**
   * Fetele detectate, ca sa fie EXCLUSE din esantionul de "gri".
   *
   * Pielea nu e neutra, dar trece filtrul de saturatie de mai sus: un ten
   * obisnuit, (215,195,175), da 0,186 — sub pragul de 0,28, exact pragul urcat
   * anume ca sa prinda dominantele calde. Consecinta, pe orice portret: tenul
   * intra in media care ar trebui sa fie gri, iar grey-world "corecteaza"
   * caldura pielii tragand toata poza spre rece. Cu cat fata ocupa mai mult din
   * cadru, cu atat mai tare.
   *
   * Nu incercam sa ghicim in schimb o tinta pentru piele — ar reintroduce fix
   * problema pentru care banda de luminanta a fetei e lasata larga (vezi
   * FACE_TOO_DARK): orice tinta e calibrata pe un ten anume si falsifica
   * restul. Scoatem doar pielea din referinta de gri; neutrul se citeste din
   * ce chiar e neutru in cadru.
   */
  faces?: { box: [number, number, number, number] }[]
): { temperature: number; tint: number } {
  const { data } = img;
  const step = 16; // acelasi esantionaj ca in computeAutoContrast
  const skin = buildFaceMask(img, faces, 0)?.mask;
  let sumR = 0, sumG = 0, sumB = 0, neutral = 0, sampled = 0;
  for (let i = 0; i < data.length; i += step) {
    sampled++;
    if (skin?.[i >> 2]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < WB_MIN_LUM || lum > WB_MAX_LUM) continue;
    const max = Math.max(r, g, b);
    if (max <= 0) continue;
    if ((max - Math.min(r, g, b)) / max > WB_SATURATION_LIMIT) continue;
    sumR += r; sumG += g; sumB += b; neutral++;
  }
  if (!sampled || neutral / sampled < WB_MIN_NEUTRAL_FRACTION) return { temperature: 0, tint: 0 };
  const meanR = sumR / neutral, meanG = sumG / neutral, meanB = sumB / neutral;
  const factor = goldenHour ? WB_GOLDEN_HOUR_FACTOR : 1;
  const temperature = Math.round(clampRange(-(meanR - meanB) * 1.25 * factor, -WB_MAX_SHIFT, WB_MAX_SHIFT)) || 0;
  const tint = Math.round(clampRange(-(meanG - (meanR + meanB) / 2) * (5 / 3) * factor, -WB_MAX_SHIFT, WB_MAX_SHIFT)) || 0;
  return { temperature, tint };
}

// ── Capetele histogramei ─────────────────────────────────────────────────────
// Contrastul intinde mijlocul; capetele sunt altceva. O poza in care cel mai
// deschis pixel e 225 si cel mai inchis 30 arata spalacita oricat contrast pui,
// fiindca nu are nici alb curat, nici negru. whites/blacks muta exact capetele.

const AUTO_WHITE_TARGET = 248;
const AUTO_BLACK_TARGET = 6;
/** Sub distanta asta fata de capat, nu merita atins nimic — poza deja ajunge acolo. */
const AUTO_LEVELS_WHITE_SLACK = 236;
const AUTO_LEVELS_BLACK_SLACK = 16;
/** Doar o parte din corectia teoretica: expunerea si contrastul se aplica INAINTE in drawAdjusted si mai misca si ele capetele. */
const AUTO_LEVELS_DAMPING = 0.7;
const AUTO_LEVELS_MAX = 35;

/** Percentila `p` (0..1) a luminantei, pe acelasi esantionaj ca restul functiilor de aici. */
function luminancePercentile(hist: Uint32Array, count: number, p: number): number {
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum / count >= p) return v;
  }
  return 255;
}

/**
 * Cat trebuie mutate capetele ca poza sa aiba si alb curat, si negru. Intoarce
 * valori pe scara sliderelor whites/blacks, inversand ponderile cubice din
 * drawAdjusted (whiteWeight = t^3, blackWeight = (1-t)^3, ambele inmultite cu
 * amount/100*55).
 */
export function computeAutoLevels(img: ImageData): { whites: number; blacks: number } {
  const { data } = img;
  const step = 16;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    hist[Math.round(clampRange(lum, 0, 255))]++;
    count++;
  }
  if (!count) return { whites: 0, blacks: 0 };
  const p99 = luminancePercentile(hist, count, 0.99);
  const p1 = luminancePercentile(hist, count, 0.01);

  // Pragul de pondere e mic (0.03), nu prudent: ponderea cubica se ocupa singura
  // de cazurile extreme. Pe o poza de noapte cu p99 = 100, corectia teoretica se
  // izbeste oricum de plafon, iar la t = 0.39 ponderea de 0.06 o reduce la ~1
  // nivel de luminanta — adica nimic. Un prag mai mare taia in schimb cazuri
  // reale (o poza spalacita cu p99 = 132 ramanea neatinsa).
  const MIN_LEVEL_WEIGHT = 0.03;
  let whites = 0;
  if (p99 < AUTO_LEVELS_WHITE_SLACK) {
    const weight = Math.pow(p99 / 255, 3);
    if (weight > MIN_LEVEL_WEIGHT) {
      whites = Math.round(clampRange(((AUTO_WHITE_TARGET - p99) / weight / 55) * 100 * AUTO_LEVELS_DAMPING, 0, AUTO_LEVELS_MAX));
    }
  }
  let blacks = 0;
  if (p1 > AUTO_LEVELS_BLACK_SLACK) {
    const weight = Math.pow(1 - p1 / 255, 3);
    if (weight > MIN_LEVEL_WEIGHT) {
      blacks = Math.round(clampRange(((AUTO_BLACK_TARGET - p1) / weight / 55) * 100 * AUTO_LEVELS_DAMPING, -AUTO_LEVELS_MAX, 0));
    }
  }
  return { whites, blacks };
}

// ── Vibranta ─────────────────────────────────────────────────────────────────
/** Sub saturatia medie asta, poza chiar e stearsa (nu o alegere de stil alb-negru: aia are ~0). */
const DULL_SATURATION = 0.16;
/** Sub atat consideram ca e intentionat alb-negru si nu atingem nimic. */
const MONOCHROME_SATURATION = 0.04;
const AUTO_VIBRANCE_MAX = 16;

/**
 * Cat sa creasca saturatia unei poze sterse. Alb-negru intentionat (saturatie
 * aproape zero) ramane neatins — a colora o poza alb-negru nu e o corectie, e
 * o alta poza.
 */
export function computeAutoVibrance(img: ImageData): number {
  const { data } = img;
  const step = 16;
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b);
    if (max <= 0) continue;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 30 || lum > 235) continue;
    sum += (max - Math.min(r, g, b)) / max;
    count++;
  }
  if (!count) return 0;
  const mean = sum / count;
  if (mean < MONOCHROME_SATURATION || mean >= DULL_SATURATION) return 0;
  const shortfall = (DULL_SATURATION - mean) / (DULL_SATURATION - MONOCHROME_SATURATION);
  return Math.round(clampRange(shortfall * AUTO_VIBRANCE_MAX, 0, AUTO_VIBRANCE_MAX));
}

const EXPOSURE_BALANCED = 50; // identic cu pragul din aiExplanationGenerator.ts
const CLIPPING_FLAG_THRESHOLD = 0.06; // identic cu generateSuggestions (aiSuggest.highlights/shadows)

/**
 * Expunere: deriva DIRECT din scorul AI deja calculat (nu dintr-un re-esantionaj
 * separat al preview-ului) — daca AI-ul zice "spre supraexpus", Auto intuneca;
 * daca zice "echilibrat", Auto nu atinge expunerea. Fara scor (poza neanalizata),
 * nicio corectie — mai bine sa nu faca nimic decat sa ghiceasca gresit.
 */
export function computeAutoExposureFromScore(exposureScore: number | undefined): number {
  if (exposureScore === undefined) return 0;
  const diff = exposureScore - EXPOSURE_BALANCED; // pozitiv = spre supraexpus, negativ = spre subexpus
  return Math.round(clampRange(-diff * 0.7, -30, 30)) || 0; // normalizeaza -0 la 0
}

/**
 * Recuperare highlights/shadows — se activeaza DOAR peste acelasi prag folosit
 * deja pentru sugestia text-uala corespunzatoare (0.06), ca Auto sa nu "vada"
 * o problema pe care panoul de explicatii n-o mentioneaza deloc. shadows
 * pozitiv LUMINEAZA umbrele (recupereaza negru inecat); highlights negativ
 * INTUNECA highlights-urile (recupereaza alb ars) — vezi drawAdjusted() mai jos.
 */
export function computeAutoHighlightsShadows(highlightClipping: number | undefined, shadowClipping: number | undefined): { highlights: number; shadows: number } {
  const highFrac = highlightClipping ?? 0;
  const lowFrac = shadowClipping ?? 0;
  const shadows = lowFrac > CLIPPING_FLAG_THRESHOLD ? Math.round(clampRange(lowFrac * 300, 8, 40)) : 0;
  const highlights = highFrac > CLIPPING_FLAG_THRESHOLD ? Math.round(clampRange(-(highFrac * 300), -40, -8)) : 0;
  return { highlights, shadows };
}

// ── Recuperare de umbre si lumini din histograma ─────────────────────────────
// Regula de mai sus se aprinde DOAR cand exista pixeli chiar arsi sau chiar
// inecati (peste 6% din cadru). Dar cele mai multe poze de telefon nu au nimic
// ars: au umbre adunate jos, fara detaliu, si lumini stranse sus — fara sa
// atinga vreodata 0 sau 255. Pentru ele, Auto nu facea nimic la capitolul asta.
// Aici se citeste chiar forma histogramei: cat de jos sta partea intunecata si
// cat de sus cea deschisa.

/** Sub atat, sfertul de jos al imaginii e adunat in negru si merita ridicat. */
const CRUSHED_SHADOW_LEVEL = 34;
/** Peste atat, partea deschisa e stransa la varf si merita adusa inapoi. */
const COMPRESSED_HIGHLIGHT_LEVEL = 226;
const TONE_RECOVERY_MAX = 34;

/**
 * Cat sa se ridice umbrele si sa se recupereze luminile, citind percentilele
 * de luminanta ale imaginii. Intoarce valori pe scara sliderelor (shadows
 * pozitiv lumineaza, highlights negativ intuneca — vezi drawAdjusted).
 */
export function computeAutoToneRecovery(img: ImageData): { highlights: number; shadows: number } {
  const { data } = img;
  const step = 16;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    hist[Math.round(clampRange(lum, 0, 255))]++;
    count++;
  }
  if (!count) return { highlights: 0, shadows: 0 };
  const p10 = luminancePercentile(hist, count, 0.10);
  const p90 = luminancePercentile(hist, count, 0.90);

  const shadows = p10 < CRUSHED_SHADOW_LEVEL
    ? Math.round(clampRange(((CRUSHED_SHADOW_LEVEL - p10) / CRUSHED_SHADOW_LEVEL) * TONE_RECOVERY_MAX, 0, TONE_RECOVERY_MAX))
    : 0;
  const highlights = p90 > COMPRESSED_HIGHLIGHT_LEVEL
    ? -Math.round(clampRange(((p90 - COMPRESSED_HIGHLIGHT_LEVEL) / (255 - COMPRESSED_HIGHLIGHT_LEVEL)) * TONE_RECOVERY_MAX, 0, TONE_RECOVERY_MAX))
    : 0;
  return { highlights, shadows };
}

/** Din doua corectii pe acelasi slider o pastreaza pe cea mai hotarata. */
function strongerOf(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

/**
 * Cat de intunecata poate fi o fata inainte sa fie clar o problema, si cat de
 * luminoasa inainte sa fie clar arsa. Luminanta relativa, 0..1.
 *
 * Banda e LARGA cu buna stiinta, si asta e o decizie, nu o scapare. Regula
 * clasica din manuale — "expune pielea la ~70%" — e calibrata pe ten deschis,
 * si aplicata ca atare ar lumina sistematic tenul inchis pana il falsifica.
 * Aici nu se urmareste nicio tinta de luminozitate a pielii: se corecteaza doar
 * esecul propriu-zis, adica fata prabusita in negru (tipic contralumina) sau
 * arsa in alb. Intre cele doua margini, Auto nu are nicio parere despre cat de
 * deschis ar trebui sa fie cineva la fata.
 */
const FACE_TOO_DARK = 0.22;
const FACE_TOO_BRIGHT = 0.88;
/** Cat poate corecta expunerea de dragul fetei — aceeasi limita ca la corectia globala. */
const FACE_EXPOSURE_LIMIT = 30;
/** Cat se strange cutia fetei spre centru inainte de esantionare — vezi mai jos. */
const FACE_INSET = 0.18;

/**
 * Luminanta medie a subiectului si a restului cadrului, dintr-o singura trecere.
 *
 * Esantionarea taie 18% din fiecare margine a cutiei fetei: cutiile detectate
 * includ mereu putin par si putin fundal, iar pe o contralumina fundalul e chiar
 * lucrul luminos care ar strica media.
 *
 * `rest` e tot ce NU e in nicio cutie de fata — nu media intregului cadru.
 * Diferenta conteaza: pe un prim-plan, fata ocupa jumatate de imagine, si o
 * medie globala ar contine chiar subiectul cu care vrem s-o comparam.
 *
 * `null` cand nu exista nicio fata masurabila (lista goala, sau numai cutii
 * degenerate/in afara cadrului).
 */
function buildFaceMask(
  img: ImageData,
  faces: { box: [number, number, number, number] }[] | undefined,
  /** Cutiile pot fi si LARGITE, nu doar stranse — vezi folosirea din computeAutoWhiteBalance. */
  inset = FACE_INSET
): { mask: Uint8Array; count: number } | null {
  if (!faces || !faces.length) return null;
  const mask = new Uint8Array(img.width * img.height);
  let count = 0;
  for (const face of faces) {
    const [fx, fy, fw, fh] = face.box;
    if (!(fw > 0) || !(fh > 0)) continue;
    const x0 = Math.max(0, Math.round((fx + fw * inset) * img.width));
    const x1 = Math.min(img.width, Math.round((fx + fw * (1 - inset)) * img.width));
    const y0 = Math.max(0, Math.round((fy + fh * inset) * img.height));
    const y1 = Math.min(img.height, Math.round((fy + fh * (1 - inset)) * img.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * img.width + x;
        if (mask[p]) continue;   // fete suprapuse: pixelul se numara o singura data
        mask[p] = 1;
        count++;
      }
    }
  }
  return count === 0 ? null : { mask, count };
}

function sampleFaces(
  img: ImageData,
  faces: { box: [number, number, number, number] }[] | undefined
): { mean: number; rest: number } | null {
  const built = buildFaceMask(img, faces);
  if (!built) return null;
  const { mask } = built;
  const lum = (p: number) => {
    const i = p * 4;
    return (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) / 255;
  };
  let sum = 0, count = 0, restSum = 0, restCount = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) { sum += lum(p); count++; } else { restSum += lum(p); restCount++; }
  }
  if (count === 0) return null;
  return { mean: sum / count, rest: restCount ? restSum / restCount : sum / count };
}

/**
 * Expunerea judecata pe SUBIECT, nu pe tot cadrul.
 *
 * De ce era nevoie: `computeAutoExposureFromScore` porneste de la scorul de
 * expunere al intregii poze. Pe o poza in contralumina — copilul in fata
 * ferestrei, apusul in spate — cadrul e stralucitor, scorul global spune
 * "supraexpusa", si Auto INTUNECA, adica exact pe dos fata de ce ar face
 * oricine cu poza aia in mana. Un om se uita la fata, nu la histograma.
 *
 * Esantionarea taie 18% din fiecare margine a cutiei fetei: cutiile detectate
 * includ mereu putin par si putin fundal, iar pe o contralumina fundalul e
 * chiar lucrul luminos care ar strica media.
 *
 * Intoarce `null`, NU 0, cand n-a putut masura nicio fata — iar distinctia e
 * chiar reparatia unui bug raportat cu captura. Inainte, ambele cazuri intorceau
 * 0, iar apelantul le trata la fel: cadea pe corectia globala. Asa, o fata
 * PERFECT expusa nu oprea cu nimic histograma intregului cadru.
 *
 * Poza raportata: fetita pe alee, in soare, cu fundalul (cer si perete) ars.
 * Fata era in regula, deci functia asta zicea 0; scorul global vedea cadrul
 * stralucitor si spunea "supraexpusa", iar Auto a scos expunerea la -10 —
 * intunecand exact subiectul, ca sa salveze un fundal oricum pierdut.
 *
 * Acum `0` inseamna "am masurat subiectul si e in regula", si are drept de VETO
 * asupra corectiei globale: daca subiectul nu e nici prabusit, nici ars, nu
 * exista niciun esec de expunere de reparat. Ce vrea histograma pe langa el e
 * fundalul care vorbeste, iar fundalul nu e fotografia.
 *
 * @returns corectia de expunere (-100..100); 0 cand subiectul e masurat si
 *   sanatos (blocheaza corectia globala); `null` cand nu exista nicio fata
 *   masurabila (apelantul cade pe corectia globala, ca inainte).
 */
export function computeAutoFaceExposure(
  img: ImageData,
  faces: { box: [number, number, number, number] }[] | undefined
): number | null {
  const sample = sampleFaces(img, faces);
  if (!sample) return null;

  const mean = sample.mean;
  if (mean < FACE_TOO_DARK) {
    // cat lipseste pana la marginea benzii, tradus in pasi de expunere
    return Math.round(clampRange((FACE_TOO_DARK - mean) * 200, 8, FACE_EXPOSURE_LIMIT));
  }
  if (mean > FACE_TOO_BRIGHT) {
    return Math.round(clampRange(-(mean - FACE_TOO_BRIGHT) * 200, -FACE_EXPOSURE_LIMIT, -8));
  }
  return 0;
}

/**
 * Cat din corectia de contrast poate prelua curba, in unitatile sliderului.
 * Peste atat, curba ar deveni vizibila ca "efect", nu ca punch.
 */
const CURVE_CONTRAST_MAX = 22;
/** Plafon pe departarea de diagonala, ca sa nu iasa niciodata o curba dramatica. */
const CURVE_MAX_DEFLECTION = 0.06;

/**
 * Contrastul pus ca CURBA, nu ca inmultire globala.
 *
 * `contrast()` din CSS pivoteaza in jurul lui 0,5 si imprastie valorile liniar,
 * deci ridicarea contrastului impinge capetele PESTE 0 si 255: umbrele se
 * infunda in negru plat, luminile se ard. Exact ce nu vrea nimeni pe o poza deja
 * contrastata — si exact motivul pentru care "auto contrast" arata, in general,
 * mai prost decat un editor care atinge o curba.
 *
 * O curba in S face aceeasi treaba unde conteaza — inclina mijlocul, deci separa
 * tonurile in care sta subiectul — dar tine capetele ANCORATE in (0,0) si (1,1),
 * deci nu poate arde si nu poate infunda nimic. Asta face un om cu o curba
 * tonala in fata, si de-aia rezultatul lui arata altfel.
 *
 * Deflexiunea urmareste ce ar fi facut contrastul global la un sfert si trei
 * sferturi din scala: acolo, un contrast de c% muta valoarea cu ~0,25·c/100.
 * Curba pleaca deci de la aceeasi intensitate, doar ca fara pretul de la capete.
 */
export function computeAutoToneCurve(contrastAmount: number): CurvePoint[] | undefined {
  const amount = Math.min(Math.max(contrastAmount, 0), CURVE_CONTRAST_MAX);
  if (amount <= 0) return undefined;
  const d = Math.min(0.25 * (amount / 100), CURVE_MAX_DEFLECTION);
  if (d < 0.005) return undefined;   // sub asta nu se vede nimic, nu merita o curba
  return [
    { x: 0, y: 0 },
    { x: 0.25, y: Math.round((0.25 - d) * 1000) / 1000 },
    { x: 0.75, y: Math.round((0.75 + d) * 1000) / 1000 },
    { x: 1, y: 1 }
  ];
}

/**
 * De cate ori trebuie sa fie fundalul mai luminos decat subiectul ca sa numim
 * cadrul contralumina. 1,7 e destul de sus cat sa nu prinda o zi senina
 * obisnuita (unde cerul e oricum mai luminos decat un chip), dar sub raportul
 * tipic al unui subiect fotografiat in fata unei ferestre sau a soarelui.
 */
const BACKLIGHT_RATIO = 1.7;
/**
 * Peste atat subiectul e deja luminos, iar diferenta fata de fundal e o alegere
 * de compozitie, nu un esec de expunere — nu avem ce "salva".
 */
const BACKLIGHT_SUBJECT_MAX = 0.6;
const BACKLIGHT_SHADOW_MAX = 34;
const BACKLIGHT_HIGHLIGHT_MAX = 24;

/**
 * Contralumina, tratata ca situatie proprie.
 *
 * Vetoul din computeAutoFaceExposure opreste Auto sa STRICE un asemenea cadru
 * (nu-l mai intuneca de dragul unui fundal ars). Dar a nu strica nu inseamna a
 * repara: un editor uman, in fata aceleiasi poze, ridica umbrele ca sa scoata
 * subiectul din intuneric si trage luminile ca fundalul sa nu urle — si NU
 * atinge expunerea globala, fiindca ea ar muta si ce e deja bun.
 *
 * De ce nu prin expunere: `brightness` inmulteste tot cadrul, deci ridicarea
 * subiectului ar arde si mai tare un fundal deja la limita. Umbrele si luminile
 * lucreaza pe zone de tonalitate, exact unde e problema.
 *
 * Magnitudinea creste cu cat subiectul e mai inchis fata de fundal, dar ramane
 * plafonata: o corectie mai mare de atat nu mai recupereaza o poza, o transforma
 * in altceva (aspectul spalacit, "HDR de telefon", pe care nimeni nu-l cere).
 *
 * `null` cand nu exista fata masurabila sau cand cadrul nu e contralumina.
 */
export function computeAutoBacklight(
  img: ImageData,
  faces: { box: [number, number, number, number] }[] | undefined
): { highlights: number; shadows: number } | null {
  const sample = sampleFaces(img, faces);
  if (!sample) return null;
  const { mean, rest } = sample;
  if (mean <= 0 || mean > BACKLIGHT_SUBJECT_MAX) return null;
  const ratio = rest / mean;
  if (ratio < BACKLIGHT_RATIO) return null;

  // 0 chiar la prag, 1 la un fundal de trei ori mai luminos si peste
  const severity = clampRange((ratio - BACKLIGHT_RATIO) / (3 - BACKLIGHT_RATIO), 0, 1);
  return {
    shadows: Math.round(clampRange(10 + severity * (BACKLIGHT_SHADOW_MAX - 10), 10, BACKLIGHT_SHADOW_MAX)),
    highlights: -Math.round(clampRange(8 + severity * (BACKLIGHT_HIGHLIGHT_MAX - 8), 8, BACKLIGHT_HIGHLIGHT_MAX))
  };
}

/**
 * Contrast: singura parte care tot are nevoie de pixelii reali (nu exista
 * niciun scor AI existent pentru "cat de plata e histograma") — intinde
 * histograma de luminanta intre percentila 2% si 98%, spre un interval
 * "sanatos" de ~200 din 255. Nu scade NICIODATA contrastul, doar il creste
 * cand chiar lipseste — tehnica clasica de auto-nivele, cu magnitudine mica
 * (clamp la 35), fara riscul demonstrat de balansul de alb "gray world"
 * (eliminat complet — nicio dominanta de culoare presupusa, vezi mai sus).
 */
export function computeAutoContrast(img: ImageData): number {
  const { data } = img;
  const step = 16; // esantionaj identic cu exposureScore/clippingScores din faceAnalysis.worker.ts
  let count = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    hist[Math.round(clampRange(lum, 0, 255))]++;
    count++;
  }
  if (!count) return 0;

  let cum = 0, p2 = 0, p98 = 255;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum / count >= 0.02) { p2 = v; break; } }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum / count >= 0.02) { p98 = v; break; } }
  const rawRange = p98 - p2;
  // interval 0 (imagine perfect plata, fara nicio textura) -> nimic de intins;
  // altfel formula de stretch ar "inventa" contrast dintr-o singura valoare
  return rawRange <= 0 ? 0 : Math.round(clampRange((clampRange(200 / rawRange, 1, 1.6) - 1) * 100, 0, 35));
}

const THIRDS_POINTS: [number, number][] = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
const RULE_OF_THIRDS_FLAG_THRESHOLD = 0.4; // identic cu aiSuggest.centered (aiExplanationGenerator.ts)
// 0.78 (nu 0.88, valoarea initiala) — feedback direct pe device real: la 0.88
// (doar 12% mai stransa incadrarea) diferenta era aproape imperceptibila la
// o privire rapida pe ecranul telefonului, lasand impresia ca "Aplica" nu
// facuse nimic. 0.78 ramane o recompozitie, nu un zoom agresiv care sa taie
// parti importante din cadru, dar chiar se observa.
const CROP_SCALE = 0.78;

/**
 * Marja de siguranta orizontala/superioara in jurul casetei fetei, ca fractiune
 * din latimea/inaltimea FETEI — nu avem detectie de corp intreg (doar fete,
 * vezi AutoAdjustSignals), deci nu putem sti exact unde sunt umerii/bratele.
 * O marja proportionala cu dimensiunea fetei ramane o aproximare rezonabila
 * DOAR pe aceste doua axe (lateral/sus), unde variatia reala e mica indiferent
 * de tipul cadrului (portret apropiat sau corp intreg). ARM_MARGIN mai mare pe
 * orizontala (un brat ridicat lateral, o mana pe umarul altcuiva) decat
 * HEAD_MARGIN pe verticala in sus (par/palarie).
 *
 * Marja de JOS nu urmeaza acelasi tipar — vezi safeBottom din computeAutoCrop
 * mai jos, unde o marja proportionala cu fata s-a dovedit insuficienta pentru
 * cadre de corp intreg.
 *
 * Bug real raportat de utilizator: recadrarea automata sectiona bratul unei
 * persoane — algoritmul vechi alinia doar CENTRUL fetei la o intersectie de
 * treimi, fara nicio garantie ca zona din jurul ei (unde poate fi un brat
 * ridicat) ramane in cadru.
 */
const ARM_MARGIN_X = 1.2;
const HEAD_MARGIN_Y = 0.6;
const BODY_MARGIN_Y = 2.5;
/**
 * Sub acest prag (inaltimea fetei ca fractiune din cadru), consideram fata
 * "mica" — semnal ca poza arata probabil corpul INTREG, la distanta (nu un
 * portret apropiat) — vezi comentariul de la safeBottom din computeAutoCrop.
 * 0.15 lasa marja BODY_MARGIN_Y (2.5x) sa functioneze neschimbat pentru
 * portrete normale (fata >= ~15% din inaltimea cadrului), unde e deja
 * verificata ca suficienta.
 */
const SMALL_FACE_HEIGHT_THRESHOLD = 0.15;

/**
 * Recadrare automata catre cea mai apropiata intersectie de treimi — DOAR
 * cand se aplica exact aceeasi conditie ca sugestia text "aiSuggest.centered"
 * (fata detectata, ruleOfThirds sub prag): Auto nu poate "vedea" o problema
 * de compozitie pe care panoul de explicatii n-o mentioneaza deloc, acelasi
 * principiu ca restul acestui fisier (vezi comentariul de la AutoAdjustSignals).
 * Fara camp de obiect principal expus pe AnalysisRecord (doar fete), scenele
 * fara oameni nu primesc recadrare automata in aceasta versiune.
 */
/**
 * Sub acest prag, fereastra rezultata e practic identica cu cadrul intreg —
 * la fel ca justificarea CROP_SCALE=0.78 (nu 0.88) de mai sus, o "recadrare"
 * prea subtila lasa impresia ca Auto n-a facut nimic, deci nu merita sa fie
 * raportata ca recompunere aplicata.
 */
const NEGLIGIBLE_CROP_SCALE = 0.92;

export function computeAutoCrop(signals: AutoAdjustSignals): EditAdjustments['crop'] {
  if (!signals.faceCount || (signals.ruleOfThirds ?? 0.5) >= RULE_OF_THIRDS_FLAG_THRESHOLD) return undefined;
  const faces = signals.faces;
  if (!faces?.length) return undefined;
  const main = faces.reduce((x, y) => (x.box[2] * x.box[3] > y.box[2] * y.box[3] ? x : y));
  const [fx, fy, fw, fh] = main.box;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  let nearest = THIRDS_POINTS[0];
  let best = Infinity;
  for (const p of THIRDS_POINTS) {
    const d = Math.hypot(cx - p[0], cy - p[1]);
    if (d < best) { best = d; nearest = p; }
  }

  const safeLeft = clampRange(fx - fw * ARM_MARGIN_X, 0, 1);
  const safeRight = clampRange(fx + fw + fw * ARM_MARGIN_X, 0, 1);
  const safeTop = clampRange(fy - fh * HEAD_MARGIN_Y, 0, 1);
  // Fata MICA (sub SMALL_FACE_HEIGHT_THRESHOLD) e singurul semnal disponibil
  // ca poza arata probabil corpul INTREG (subiect la distanta) — o marja
  // proportionala cu fata (BODY_MARGIN_Y, calibrata pentru un portret
  // apropiat) subestimeaza drastic distanta reala pana la picioare in acel
  // caz (poate fi 6-8x inaltimea fetei, nu 2.5x) — bug real raportat de
  // utilizator, picioare taiate. Pentru fete mici, protejam TOT ce e vizibil
  // sub fata, pana la marginea de jos a cadrului ORIGINAL.
  const safeBottom = fh < SMALL_FACE_HEIGHT_THRESHOLD
    ? 1
    : clampRange(fy + fh + fh * BODY_MARGIN_Y, 0, 1);

  // Scala minima (uniforma pe ambele axe, pastreaza raportul de aspect) care
  // CHIAR incape zona de siguranta — pornim de la CROP_SCALE (recompunerea
  // "ideala"), dar largim fereastra (pana la cadrul intreg) daca zona de
  // siguranta o cere, in loc sa renuntam complet la orice recompunere de
  // indata ce 0.78 nu mai ajunge. Bug real raportat de utilizator: varianta
  // veche renunta TOTAL la recadrare pe orice poza de corp intreg (safeBottom
  // de mai sus ajunge mereu la 1 pentru fete mici) — chiar si atunci cand o
  // recompunere mai blanda (fereastra putin mai mare) tot ar fi fost posibila
  // si utila, nu doar "totul sau nimic".
  const scale = Math.min(1, Math.max(CROP_SCALE, safeRight - safeLeft, safeBottom - safeTop));
  if (scale >= NEGLIGIBLE_CROP_SCALE) return undefined;
  const w = scale, h = scale;
  let x = clampRange(cx - nearest[0] * w, 0, 1 - w);
  let y = clampRange(cy - nearest[1] * h, 0, 1 - h);

  // Impinge fereastra sa acopere intreaga zona de siguranta, chiar daca asta
  // strica usor alinierea pe treimi — un cadru usor decentrat e de preferat
  // unuia care taie un brat/umeri/picioare.
  if (x > safeLeft) x = safeLeft;
  if (x + w < safeRight) x = safeRight - w;
  if (y > safeTop) y = safeTop;
  if (y + h < safeBottom) y = safeBottom - h;
  x = clampRange(x, 0, 1 - w);
  y = clampRange(y, 0, 1 - h);

  return { x, y, width: w, height: h };
}

const HORIZON_FLAG_THRESHOLD_DEG = 2; // identic cu aiSuggest.horizonTilt

/**
 * Indreptare automata a orizontului — doar pe scene fara fete (acelasi
 * tipar ca aiSuggest.horizonTilt), peste acelasi prag de 2° folosit acolo.
 * NEVERIFICAT pe o poza reala cu orizont inclinat: presupune conventia
 * standard "unghi pozitiv = inclinare in sensul acelor de ceasornic", aceeasi
 * ca horizonTiltDeg din faceAnalysis.worker.ts — daca la testare pe device
 * orizontul se indreapta in directia GRESITA, aici e primul loc de verificat
 * (acelasi tip de avertisment ca headPoseFromMatrix in FaceMeshMath.kt).
 */
export function computeAutoStraighten(signals: AutoAdjustSignals): number {
  if (signals.faceCount || signals.horizonTiltDeg === undefined || Math.abs(signals.horizonTiltDeg) <= HORIZON_FLAG_THRESHOLD_DEG) return 0;
  return Math.round(clampRange(-signals.horizonTiltDeg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG));
}

const COLOR_HARMONY_FLAG_THRESHOLD = 0.35; // identic cu aiSuggest.colorHarmony
const AUTO_DESATURATE_AMOUNT = -12;

/**
 * Singura corectie de "culoare" din Auto — DOAR o desaturare modesta, NU o
 * corectie de balans de alb/temperatura (vezi comentariul de la
 * AutoAdjustSignals despre incercarea anterioara esuata). Directia e
 * justificata (mai putina saturatie = mai putina disonanta vizuala intre
 * culori dezordonate), spre deosebire de o presupunere de directie pentru
 * temperatura/tinta, pentru care nu exista niciun semnal de incredere.
 */
export function computeAutoSaturation(signals: AutoAdjustSignals): number {
  return signals.colorHarmonyScore !== undefined && signals.colorHarmonyScore < COLOR_HARMONY_FLAG_THRESHOLD ? AUTO_DESATURATE_AMOUNT : 0;
}

/**
 * Punctul de intrare pentru butonul "Auto" din EditPanel: combina scorurile
 * AI deja calculate (`signals`, din AnalysisRecord — acelasi obiect afisat in
 * "De ce acest scor") cu singura statistica de pixel ramasa necesara
 * (contrastul). Rezultatul e doar un PUNCT DE PORNIRE — utilizatorul poate
 * regla oricare slider dupa, exact ca dupa o editare manuala (nimic
 * destructiv, EditPanel salveaza doar valorile, nu pixeli). Temperatura/tinta
 * raman intentionat neatinse (0) — nicio sursa de incredere pentru ele in
 * datele deja calculate ale aplicatiei (vezi comentariul de la AutoAdjustSignals).
 */
export function computeAutoAdjustments(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, signals: AutoAdjustSignals = {}): EditAdjustments {
  const MAX_DIM = 360;
  const scale = Math.min(1, MAX_DIM / Math.max(sourceWidth, sourceHeight));
  const w = Math.max(1, Math.round(sourceWidth * scale));
  const h = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  let contrast = 0;
  let faceExposure: number | null = null;
  let whiteBalance = { temperature: 0, tint: 0 };
  let levels = { whites: 0, blacks: 0 };
  let vibrance = 0;
  let toneRecovery = { highlights: 0, shadows: 0 };
  let backlight: { highlights: number; shadows: number } | null = null;
  if (ctx) {
    ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    contrast = computeAutoContrast(data);
    faceExposure = computeAutoFaceExposure(data, signals.faces);
    backlight = computeAutoBacklight(data, signals.faces);
    whiteBalance = computeAutoWhiteBalance(data, signals.goldenHourDetected === true, signals.faces);
    levels = computeAutoLevels(data);
    vibrance = computeAutoVibrance(data);
    toneRecovery = computeAutoToneRecovery(data);
  }
  const clipped = computeAutoHighlightsShadows(signals.highlightClipping, signals.shadowClipping);
  // Doua surse pentru aceleasi doua slidere: pragurile de ardere (cand chiar
  // exista pixeli pierduti) si forma histogramei (cand nu e nimic ars, dar
  // umbrele stau adunate jos). Se pastreaza corectia mai hotarata din fiecare.
  // A treia sursa pentru aceleasi doua slidere, cand cadrul e contralumina.
  // Vetoul de expunere doar opreste Auto sa strice o astfel de poza; asta o si
  // repara, pe zone de tonalitate, fara sa atinga expunerea globala.
  const highlights = strongerOf(strongerOf(clipped.highlights, toneRecovery.highlights), backlight?.highlights ?? 0);
  const shadows = strongerOf(strongerOf(clipped.shadows, toneRecovery.shadows), backlight?.shadows ?? 0);

  // O poza dezacordata cromatic se calmeaza (computeAutoSaturation, negativ);
  // una stearsa se ridica (computeAutoVibrance, pozitiv). Nu pot fi amandoua
  // deodata — cea negativa are prioritate, fiindca "prea multa culoare pusa
  // alandala" e un defect mai vizibil decat "prea putina".
  const harmonySaturation = computeAutoSaturation(signals);

  // Cand exista un subiect masurabil, EL hotaraste expunerea — nu histograma
  // intregului cadru. Pe o contralumina cele doua spun exact pe dos, iar omul cu
  // poza in mana se ia dupa fata.
  //
  // Inclusiv cand raspunsul subiectului e "nu schimba nimic" (faceExposure = 0):
  // asta nu mai inseamna "n-am nicio parere", ci "am masurat si e sanatos", deci
  // corectia globala nu mai are ce sa suprascrie. Doar cand nu exista nicio fata
  // masurabila (null) se cade inapoi pe scorul intregului cadru.
  // Punch-ul pleaca in curba, unde capetele raman ancorate; sliderul global
  // pastreaza doar ce depaseste ce poate duce curba — de obicei, nimic. Asa,
  // Auto nu mai infunda umbrele si nu mai arde luminile ca sa dea contrast.
  const toneCurve = computeAutoToneCurve(contrast);
  const residualContrast = toneCurve ? Math.max(0, contrast - CURVE_CONTRAST_MAX) : contrast;

  return {
    exposure: faceExposure !== null ? faceExposure : computeAutoExposureFromScore(signals.exposureScore),
    contrast: residualContrast,
    ...(toneCurve ? { curves: { master: toneCurve } } : {}),
    saturation: harmonySaturation !== 0 ? harmonySaturation : vibrance,
    temperature: whiteBalance.temperature,
    tint: whiteBalance.tint,
    highlights,
    shadows,
    whites: levels.whites,
    blacks: levels.blacks,
    rotationDeg: computeAutoStraighten(signals),
    crop: computeAutoCrop(signals)
  };
}

/**
 * Randeaza ajustarile pe un blob (ex. miniatura din galeria pentru client) si
 * intoarce un JPEG nou — folosit doar acolo unde utilizatorul alege EXPLICIT
 * sa "coaca" editarile intr-un export (nu modifica blob-ul original din
 * IndexedDB). `blob` neschimbat daca nu exista nicio ajustare reala, ca sa nu
 * piarda calitate printr-un re-encode inutil.
 */
export async function applyAdjustmentsToBlob(blob: Blob, adjustments: EditAdjustments, quality = 0.85): Promise<Blob> {
  if (isNeutral(adjustments)) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    drawAdjusted(ctx, bitmap, bitmap.width, bitmap.height, canvas.width, canvas.height, adjustments);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
    );
  } finally {
    bitmap.close();
  }
}
