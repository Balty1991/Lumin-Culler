/**
 * core/toneCurve.ts
 * Curba tonala — instrumentul care lipsea ca sa se poata numi editor serios.
 * Sliderele de expunere/contrast muta TOATA gama deodata; curba lasa
 * fotograful sa spuna exact "ridica umbrele, lasa luminile pe loc", sau sa
 * faca un fade cinematografic ridicand negrul. Snapseed, Lightroom si
 * Capture One au toate acelasi instrument, si toate il implementeaza la fel:
 * cateva puncte de control, interpolate printr-o curba MONOTONA.
 *
 * Interpolarea e Fritsch–Carlson (Hermite cubic monoton), nu spline natural.
 * Motivul e practic, nu academic: un spline natural care trece prin punctele
 * (0,0), (0.5, 0.52), (1,1) "supra-oscileaza" — coboara sub 0 langa capat si
 * intoarce curba invers pe o portiune. Pe o poza, asta inseamna ca ridicand
 * umbrele se INTUNECA o fasie din ele: exact opusul a ce a cerut omul.
 * Fritsch–Carlson garanteaza ca daca punctele urca, curba nu coboara nicaieri.
 *
 * Costul la randare e nul: oricate curbe ar fi setate (master + R/G/B), totul
 * se pliaza INAINTE de bucla pe pixeli in trei tabele de 256 de valori, deci
 * pretul per pixel e fix — trei citiri din tablou — vezi buildChannelLuts.
 */

export interface CurvePoint {
  /** Intrare, 0..1 (0 = negru, 1 = alb). */
  x: number;
  /** Iesire, 0..1. */
  y: number;
}

/** Curba care nu face nimic: identitatea. */
export const LINEAR_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

/** Cate puncte de control acceptam pe o curba — peste atat, editorul devine imposibil de folosit cu degetul pe telefon. */
export const MAX_CURVE_POINTS = 8;

/** Cat de aproape (in unitati 0..1) trebuie sa fie doua puncte ca sa le consideram acelasi punct — vezi addCurvePoint. */
const MIN_POINT_DISTANCE = 0.04;

/**
 * Curbele unei poze. Fiecare e optionala: absenta inseamna liniara, deci
 * inregistrarile vechi din Dexie (dinainte de acest camp) raman valide fara
 * nicio migrare.
 */
export interface PhotoCurves {
  /** Curba de luminozitate, aplicata pe toate cele trei canale. */
  master?: CurvePoint[];
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
}

export type CurveChannel = 'master' | 'red' | 'green' | 'blue';
export const CURVE_CHANNELS: CurveChannel[] = ['master', 'red', 'green', 'blue'];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** true daca curba nu schimba nimic (absenta, sub doua puncte, sau exact identitatea). */
export function isLinearCurve(points: CurvePoint[] | undefined): boolean {
  if (!points || points.length < 2) return true;
  return points.every(p => Math.abs(p.y - p.x) < 1e-6);
}

/** true daca NICIUNA dintre curbele pozei nu schimba ceva — folosit ca sa sarim complet peste pasul de curbe. */
export function hasNoCurves(curves: PhotoCurves | undefined): boolean {
  if (!curves) return true;
  return isLinearCurve(curves.master) && isLinearCurve(curves.red)
    && isLinearCurve(curves.green) && isLinearCurve(curves.blue);
}

/**
 * Ordoneaza punctele dupa x si le tine in 0..1. Capetele NU sunt fortate la
 * x=0 si x=1: un fotograf care ridica negrul pune deliberat primul punct la
 * (0, 0.1), iar evaluarea de mai jos extinde orizontal dincolo de capete.
 */
function normalize(points: CurvePoint[]): CurvePoint[] {
  return points
    .map(p => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
}

/**
 * Pantele Fritsch–Carlson: pornim de la panta medie in fiecare nod, apoi le
 * corectam acolo unde ar produce depasire. Conditia (Fritsch & Carlson 1980)
 * e ca punctul (alpha, beta) = (m[i]/delta[i], m[i+1]/delta[i]) sa ramana in
 * cercul de raza 3 — implementata mai jos prin scalarea ambelor pante.
 */
function monotoneSlopes(pts: CurvePoint[]): number[] {
  const n = pts.length;
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    // doua puncte pe aceeasi verticala ar da impartire la zero; le tratam ca palier
    delta.push(dx > 1e-9 ? (pts[i + 1].y - pts[i].y) / dx : 0);
  }
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // panta zero de o parte si de alta a unui extrem local — obligatoriu, altfel
    // curba ar depasi punctul de control chiar acolo unde omul l-a pus
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const alpha = m[i] / delta[i];
    const beta = m[i + 1] / delta[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * delta[i];
      m[i + 1] = tau * beta * delta[i];
    }
  }
  return m;
}

/**
 * Valoarea curbei intr-un punct x (0..1). In afara intervalului acoperit de
 * puncte, curba se prelungeste ORIZONTAL (cu valoarea capatului) — asa se
 * comporta si curba din Lightroom cand primul punct nu e la x=0.
 */
export function evaluateCurve(points: CurvePoint[] | undefined, x: number): number {
  if (!points || points.length === 0) return clamp01(x);
  const pts = normalize(points);
  if (pts.length === 1) return pts[0].y;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

  const m = monotoneSlopes(pts);
  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1].x) i++;
  const h = pts[i + 1].x - pts[i].x;
  if (h <= 1e-9) return pts[i + 1].y;
  const t = (x - pts[i].x) / h;
  const t2 = t * t, t3 = t2 * t;
  // baza Hermite
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return clamp01(h00 * pts[i].y + h10 * h * m[i] + h01 * pts[i + 1].y + h11 * h * m[i + 1]);
}

/** Tabelul de 256 de valori al unei curbe — calculat o data per redesenare, nu per pixel. */
export function buildCurveLut(points: CurvePoint[] | undefined): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  if (isLinearCurve(points)) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const pts = normalize(points!);
  const m = monotoneSlopes(pts);
  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y: number;
    if (x <= pts[0].x) y = pts[0].y;
    else if (x >= pts[pts.length - 1].x) y = pts[pts.length - 1].y;
    else {
      while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++;
      const h = pts[seg + 1].x - pts[seg].x;
      if (h <= 1e-9) y = pts[seg + 1].y;
      else {
        const t = (x - pts[seg].x) / h, t2 = t * t, t3 = t2 * t;
        y = clamp01(
          (2 * t3 - 3 * t2 + 1) * pts[seg].y + (t3 - 2 * t2 + t) * h * m[seg]
          + (-2 * t3 + 3 * t2) * pts[seg + 1].y + (t3 - t2) * h * m[seg + 1]
        );
      }
    }
    lut[i] = Math.round(y * 255);
  }
  return lut;
}

/**
 * Cele TREI tabele finale, cu master-ul deja compus peste fiecare canal.
 * Compunerea se face aici, o singura data, tocmai ca bucla pe pixeli sa nu
 * stie nimic despre cate curbe a desenat utilizatorul: pretul e mereu trei
 * citiri din tablou, fie ca e o curba, fie ca sunt patru.
 * Intoarce null cand nicio curba nu schimba nimic — semnal pentru apelant sa
 * sara complet peste pas.
 */
let lutCacheKey: string | null = null;
let lutCache: { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } | null = null;

export function buildChannelLuts(curves: PhotoCurves | undefined): { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } | null {
  if (hasNoCurves(curves)) return null;
  // Un slot de cache: cat timp utilizatorul trage ALT slider (expunere,
  // vinieta...), curbele nu se schimba, dar functia asta era chemata la
  // fiecare cadru si reevalua patru spline-uri de cate 256 de valori degeaba.
  const key = JSON.stringify(curves);
  if (key === lutCacheKey && lutCache) return lutCache;
  const master = buildCurveLut(curves!.master);
  const out = {
    r: buildCurveLut(curves!.red),
    g: buildCurveLut(curves!.green),
    b: buildCurveLut(curves!.blue)
  };
  // master ULTIMUL, ca in Lightroom: curbele de canal schimba culoarea, curba
  // de luminozitate se aplica peste rezultat.
  for (let i = 0; i < 256; i++) {
    out.r[i] = master[out.r[i]];
    out.g[i] = master[out.g[i]];
    out.b[i] = master[out.b[i]];
  }
  lutCacheKey = key;
  lutCache = out;
  return out;
}

/**
 * Adauga un punct, respectand limita si distanta minima fata de vecini.
 * Intoarce lista NESCHIMBATA daca punctul ar fi prea aproape de altul (ar
 * face curba imposibil de manevrat cu degetul) sau daca s-a atins maximul.
 */
export function addCurvePoint(points: CurvePoint[], p: CurvePoint): CurvePoint[] {
  const pts = normalize(points);
  if (pts.length >= MAX_CURVE_POINTS) return points;
  if (pts.some(q => Math.abs(q.x - p.x) < MIN_POINT_DISTANCE)) return points;
  return normalize([...pts, { x: clamp01(p.x), y: clamp01(p.y) }]);
}

/**
 * Muta punctul de la `index`. Punctele NU se pot depasi unul pe altul pe axa
 * x (curba trebuie sa ramana o functie), asa ca x-ul e prins intre vecini.
 */
export function moveCurvePoint(points: CurvePoint[], index: number, p: CurvePoint): CurvePoint[] {
  const pts = normalize(points);
  if (index < 0 || index >= pts.length) return pts;
  const lo = index === 0 ? 0 : pts[index - 1].x + 0.01;
  const hi = index === pts.length - 1 ? 1 : pts[index + 1].x - 0.01;
  const x = Math.min(Math.max(clamp01(p.x), lo), Math.max(lo, hi));
  const next = pts.slice();
  next[index] = { x, y: clamp01(p.y) };
  return next;
}

/** Scoate un punct. Ultimele doua nu se pot scoate — o curba are nevoie de doua capete. */
export function removeCurvePoint(points: CurvePoint[], index: number): CurvePoint[] {
  const pts = normalize(points);
  if (pts.length <= 2 || index < 0 || index >= pts.length) return pts;
  return pts.filter((_, i) => i !== index);
}

/** Indexul punctului aflat sub degete, sau -1 — `radius` in aceleasi unitati 0..1. */
export function findCurvePoint(points: CurvePoint[], x: number, y: number, radius: number): number {
  const pts = normalize(points);
  let best = -1, bestD = radius * radius;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x, dy = pts[i].y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Presetari de curba — acelasi rol ca "Looks"-urile din Snapseed, dar exprimate
 * in singurul instrument care le poate produce pe toate. Sunt scurtaturi, nu
 * un mod separat: dupa ce se aplica una, punctele raman editabile.
 */
export const CURVE_PRESETS: { key: string; curves: PhotoCurves }[] = [
  {
    key: 'linear',
    curves: {}
  },
  {
    // S usor: contrast in gama medie, capetele neatinse
    key: 'contrast',
    curves: { master: [{ x: 0, y: 0 }, { x: 0.25, y: 0.19 }, { x: 0.75, y: 0.81 }, { x: 1, y: 1 }] }
  },
  {
    // negrul ridicat + luminile temperate: aspectul "film" / mat
    key: 'faded',
    curves: { master: [{ x: 0, y: 0.11 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.94 }] }
  },
  {
    // umbre reci, lumini calde — virajul cinematografic clasic
    key: 'cinematic',
    curves: {
      master: [{ x: 0, y: 0.04 }, { x: 0.3, y: 0.26 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.47 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0.06 }, { x: 0.5, y: 0.53 }, { x: 1, y: 1 }]
    }
  },
  {
    // deschide umbrele fara sa spele luminile — pentru contre-jour
    key: 'liftShadows',
    curves: { master: [{ x: 0, y: 0 }, { x: 0.25, y: 0.36 }, { x: 0.7, y: 0.73 }, { x: 1, y: 1 }] }
  }
];
