/**
 * core/imageAdjust.ts
 * Ajustari de baza non-destructive (expunere/contrast/saturatie/temperatura/
 * tinta/highlights/shadows) — nu modifica niciodata blob-ul original sau
 * preview-ul stocat, doar re-deseneaza pe un canvas la cerere (DetailView,
 * export). Valorile se salveaza pe PhotoRecord.edits (core/db.ts) si se pot
 * reseta oricand fara pierdere de calitate, exact ca develop module-ul dintr-un
 * soft de catalogare (Lightroom/Capture One), dar mult mai restrans in scop.
 */

export interface EditAdjustments {
  exposure: number;    // -100..100
  contrast: number;    // -100..100
  saturation: number;  // -100..100
  temperature: number; // -100..100 (rece <-> cald)
  tint: number;        // -100..100 (verde <-> magenta)
  highlights: number;  // -100..100
  shadows: number;     // -100..100
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
}

export const NEUTRAL_ADJUSTMENTS: EditAdjustments = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, rotationDeg: 0,
  sharpen: 0, clarity: 0, noiseReduction: 0
};

/** Doar cheile NUMERICE, comparabile direct cu 0 — `crop` (obiect sau absent) e tratat separat in isNeutral(), nu apartine acestui tipar. */
export const ADJUSTMENT_KEYS = Object.keys(NEUTRAL_ADJUSTMENTS) as (keyof typeof NEUTRAL_ADJUSTMENTS)[];

/** true daca nu exista nicio ajustare (absent SAU toate valorile 0, fara crop) — folosit pentru badge-ul "editat" si starea butonului Reseteaza. */
export function isNeutral(a: EditAdjustments | undefined): boolean {
  if (!a) return true;
  return ADJUSTMENT_KEYS.every(k => (a[k] ?? 0) === 0) && !a.crop;
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
  ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;
  drawGeometry(ctx, source, sourceWidth, sourceHeight, width, height, a);
  ctx.filter = 'none';

  const hasColorShift = a.temperature !== 0 || a.tint !== 0 || a.highlights !== 0 || a.shadows !== 0;
  const hasDetailPass = (a.sharpen ?? 0) !== 0 || (a.clarity ?? 0) !== 0 || (a.noiseReduction ?? 0) !== 0;
  if (!hasColorShift && !hasDetailPass) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;

  if (hasColorShift) {
    const tempShift = (a.temperature / 100) * 40;  // pana la ±40 pe canalele R/B (cald/rece)
    const tintShift = (a.tint / 100) * 40;         // pana la ±40 pe G vs R+B (verde/magenta)
    const highlightAmt = (a.highlights / 100) * 60;
    const shadowAmt = (a.shadows / 100) * 60;
    const hasToneShift = highlightAmt !== 0 || shadowAmt !== 0;

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
        const delta = highlightAmt * hiWeight + shadowAmt * shWeight;
        r += delta; g += delta; b += delta;
      }

      d[i] = clamp255(r); d[i + 1] = clamp255(g); d[i + 2] = clamp255(b);
    }
  }

  if (hasDetailPass) applyDetailPass(d, width, height, a);

  ctx.putImageData(imgData, 0, 0);
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
  if (ctx) {
    ctx.drawImage(source, 0, 0, w, h);
    contrast = computeAutoContrast(ctx.getImageData(0, 0, w, h));
  }
  const { highlights, shadows } = computeAutoHighlightsShadows(signals.highlightClipping, signals.shadowClipping);

  return {
    exposure: computeAutoExposureFromScore(signals.exposureScore),
    contrast,
    saturation: computeAutoSaturation(signals),
    temperature: 0,
    tint: 0,
    highlights,
    shadows,
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
