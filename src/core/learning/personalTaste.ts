/**
 * core/learning/personalTaste.ts
 * Gustul omului, învățat din alegerile lui: un model liniar pe amprenta CLIP a pozelor
 * (ce e în poză, cum arată), antrenat pe telefon.
 *
 * Motorul de preferințe v2 (etapa 3 a transformării):
 *  - învață din două feluri de exemple, cu aceleași greutăți:
 *      poze păstrate / scoase (regresie logistică, clase echilibrate) și
 *      perechi „asta, nu aia” din compararea cadrelor (Bradley–Terry: P(a > b) = σ(w·(a − b)));
 *  - testat cinstit: validare pe grupuri (zile), ca pozele aceluiași eveniment să nu fie
 *    și la antrenare și la test (altfel testul e prea ușor și procentul minte);
 *  - calibrat (Platt): „85%” înseamnă cam 85%, nu un număr oarecare;
 *  - cu puține exemple, părerea lui e trasă spre scorul general (prior), nu dată ca sigură.
 *
 * Cinstit: modelul se folosește doar dacă trece testul pe alegeri nevăzute (≥ 70%).
 */
export interface TasteModel {
  w: number[];
  b: number;
  /** Câte alegeri l-au antrenat (poze + perechi). */
  n: number;
  /** Acuratețea pe alegeri nevăzute (validare pe grupuri), 0..1. */
  accuracy: number;
  at: number;
  /** Calibrarea Platt: p = σ(ca·z + cb). Lipsă la modelele vechi (= 1, 0). */
  ca?: number;
  cb?: number;
  /** Câte perechi „asta, nu aia” au intrat. */
  pairs?: number;
}

/** O poză hotărâtă de om. `g` = grupul (ziua) pentru validare. */
export interface TasteSample { x: readonly number[]; y: 0 | 1; g?: string }
/** Perechea „asta (w), nu aia (l)”, amprentele celor două poze. */
export interface TastePair { w: readonly number[]; l: readonly number[]; g?: string }

const KEY = 'cp.taste.model.v1';
export const MIN_SAMPLES = 20;
export const MIN_PER_CLASS = 6;
export const MIN_ACCURACY = 0.7;
/** O pereche cântărește cât atâtea poze: e mai curată (aceeași scenă). */
const PAIR_WEIGHT = 1.5;
/** Câte exemple valorează „priorul”: sub atât, părerea e trasă spre scorul general. */
export const PRIOR_STRENGTH = 30;

function normalize(x: readonly number[]): number[] {
  let s = 0;
  for (const v of x) s += v * v;
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  return x.map(v => v * k);
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function dot(w: readonly number[], x: readonly number[]): number {
  let z = 0;
  for (let j = 0; j < x.length && j < w.length; j++) z += w[j] * x[j];
  return z;
}

/**
 * Antrenare: gradient descendent cu L2. Pozele: clase echilibrate (oamenii scot mai mult decât
 * păstrează). Perechile: fără termen liber (doar diferența contează).
 */
export function trainLogistic(samples: readonly TasteSample[], epochs = 300, lr = 0.8, l2 = 0.002, pairs: readonly TastePair[] = []): { w: number[]; b: number } {
  const d = samples[0]?.x.length ?? pairs[0]?.w.length ?? 0;
  const xs = samples.map(s => normalize(s.x));
  const ds = pairs.map(p => { const a = normalize(p.w), c = normalize(p.l); return a.map((v, j) => v - c[j]); });
  const pos = samples.filter(s => s.y === 1).length;
  const neg = samples.length - pos;
  const wPos = pos ? samples.length / (2 * pos) : 1;
  const wNeg = neg ? samples.length / (2 * neg) : 1;
  const total = xs.length + ds.length * PAIR_WEIGHT || 1;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  // Amprentele normalizate au produse mici; scalăm ca modelul să poată separa.
  const SCALE = 8;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * x[j] * SCALE;
      const err = (sigmoid(z) - samples[i].y) * (samples[i].y === 1 ? wPos : wNeg);
      for (let j = 0; j < d; j++) gw[j] += err * x[j] * SCALE;
      gb += err;
    }
    for (const x of ds) {
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * x[j] * SCALE;
      const err = (sigmoid(z) - 1) * PAIR_WEIGHT;
      for (let j = 0; j < d; j++) gw[j] += err * x[j] * SCALE;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / total + l2 * w[j]);
    if (xs.length) b -= lr * (gb / xs.length);
  }
  return { w: w.map(v => v * SCALE), b };
}

/** Scorul brut (înainte de calibrare). */
export function tasteLogit(model: Pick<TasteModel, 'w' | 'b'>, x: readonly number[]): number {
  return model.b + dot(model.w, normalize(x));
}

/** Probabilitatea calibrată că omul păstrează poza. */
export function predictTaste(model: Pick<TasteModel, 'w' | 'b' | 'ca' | 'cb'>, x: readonly number[]): number {
  return sigmoid((model.ca ?? 1) * tasteLogit(model, x) + (model.cb ?? 0));
}

/**
 * Părerea finală pentru o poză: modelul personal, tras spre scorul general (`generic`, 0..1)
 * cât timp are puține exemple. La PRIOR_STRENGTH exemple, jumătate-jumătate; la 300, ~91% personal.
 */
export function blendWithPrior(model: Pick<TasteModel, 'w' | 'b' | 'ca' | 'cb' | 'n'>, x: readonly number[], generic: number): number {
  const k = model.n / (model.n + PRIOR_STRENGTH);
  return k * predictTaste(model, x) + (1 - k) * Math.min(1, Math.max(0, generic));
}

/** Grupul unei poze în validare: grupul dat (ziua) sau, fără el, un amestec determinist. */
function foldOf(key: string, k: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % k;
}

interface Fold { trainS: TasteSample[]; testS: TasteSample[]; trainP: TastePair[]; testP: TastePair[] }

function folds(samples: readonly TasteSample[], pairs: readonly TastePair[], k: number): Fold[] {
  const out: Fold[] = Array.from({ length: k }, () => ({ trainS: [], testS: [], trainP: [], testP: [] }));
  samples.forEach((s, i) => {
    const f = foldOf(s.g ?? `s${i * 2654435761}`, k);
    out.forEach((fo, j) => (j === f ? fo.testS : fo.trainS).push(s));
  });
  pairs.forEach((p, i) => {
    const f = foldOf(p.g ?? `p${i * 2654435761}`, k);
    out.forEach((fo, j) => (j === f ? fo.testP : fo.trainP).push(p));
  });
  return out;
}

/**
 * Validare pe grupuri în k părți: cât de des ghicește alegerile pe care nu le-a văzut, din
 * zile pe care nu le-a văzut. Întoarce și scorurile brute, pentru calibrare.
 */
export function crossValidateDetailed(samples: readonly TasteSample[], k = 5, pairs: readonly TastePair[] = []): { accuracy: number; oof: { z: number; y: 0 | 1 }[] } {
  if (samples.length < k * 2) return { accuracy: 0, oof: [] };
  let hits = 0, seen = 0;
  const oof: { z: number; y: 0 | 1 }[] = [];
  for (const f of folds(samples, pairs, k)) {
    if (!f.testS.length && !f.testP.length) continue;
    if (!f.trainS.some(s => s.y === 1) || !f.trainS.some(s => s.y === 0)) continue;
    const m = trainLogistic(f.trainS, 150, 0.8, 0.002, f.trainP);
    for (const s of f.testS) {
      const z = tasteLogit(m, s.x);
      oof.push({ z, y: s.y });
      if ((z >= 0 ? 1 : 0) === s.y) hits++;
      seen++;
    }
    for (const p of f.testP) {
      if (tasteLogit(m, p.w) > tasteLogit(m, p.l)) hits++;
      seen++;
    }
  }
  return { accuracy: seen ? hits / seen : 0, oof };
}

export function crossValidate(samples: readonly TasteSample[], k = 5, pairs: readonly TastePair[] = []): number {
  return crossValidateDetailed(samples, k, pairs).accuracy;
}

/** Calibrarea Platt pe scorurile din afara antrenării: p = σ(a·z + b). */
export function plattFit(oof: readonly { z: number; y: 0 | 1 }[]): { a: number; b: number } {
  if (oof.length < 10 || !oof.some(o => o.y === 1) || !oof.some(o => o.y === 0)) return { a: 1, b: 0 };
  const pos = oof.filter(o => o.y === 1).length, neg = oof.length - pos;
  // Țintele netezite ale lui Platt, ca să nu împingă spre 0 / 1 absolut.
  const tPos = (pos + 1) / (pos + 2), tNeg = 1 / (neg + 2);
  let a = 1, b = 0;
  for (let it = 0; it < 400; it++) {
    let ga = 0, gb = 0;
    for (const o of oof) {
      const err = sigmoid(a * o.z + b) - (o.y === 1 ? tPos : tNeg);
      ga += err * o.z; gb += err;
    }
    a -= 0.5 * ga / oof.length;
    b -= 0.5 * gb / oof.length;
  }
  // O pantă negativă ar inversa părerea modelului: atunci nu calibrăm.
  return a > 0 ? { a, b } : { a: 1, b: 0 };
}

export function buildTasteModel(samples: readonly TasteSample[], now = Date.now(), pairs: readonly TastePair[] = []): TasteModel | null {
  const pos = samples.filter(s => s.y === 1).length;
  const neg = samples.length - pos;
  if (samples.length < MIN_SAMPLES || pos < MIN_PER_CLASS || neg < MIN_PER_CLASS) return null;
  const { accuracy, oof } = crossValidateDetailed(samples, 5, pairs);
  const { a, b: cb } = plattFit(oof);
  const { w, b } = trainLogistic(samples, 300, 0.8, 0.002, pairs);
  return { w, b, n: samples.length + pairs.length, accuracy, at: now, ca: a, cb, pairs: pairs.length };
}

/**
 * Model nou în umbră: îl înlocuiește pe cel vechi doar dacă ghicește cel puțin la fel de bine
 * zilele nevăzute (amândouă măsurate la fel, pe validarea pe grupuri; o toleranță mică, ca
 * modelul să urmeze gustul care se schimbă). Fără model vechi bun, cel nou câștigă.
 */
export function preferModel(fresh: TasteModel, old: TasteModel | null): TasteModel {
  // Modelele v1 (fără calibrare) au fost testate fără grupuri, deci cu un procent umflat:
  // nu se compară, cel nou le ia locul.
  if (!old || !usableTaste(old) || old.ca === undefined || old.w.length !== fresh.w.length) return fresh;
  return fresh.accuracy + 0.02 >= old.accuracy ? fresh : old;
}

export function readTasteModel(): TasteModel | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && Array.isArray(raw.w) && typeof raw.b === 'number' ? raw as TasteModel : null;
  } catch { return null; }
}

export function writeTasteModel(m: TasteModel): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...m, w: m.w.map(v => Math.round(v * 1e4) / 1e4) })); } catch { /* fără loc */ }
}

/** Modelul e destul de bun ca să schimbe decizii? */
export function usableTaste(m: TasteModel | null): m is TasteModel {
  return !!m && m.accuracy >= MIN_ACCURACY;
}
