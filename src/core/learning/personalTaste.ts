/**
 * core/learning/personalTaste.ts
 * Gustul omului, învățat din alegerile lui: o regresie logistică pe amprenta CLIP a pozelor
 * (ce e în poză, cum arată), antrenată pe telefon, din pozele păstrate și scoase de om.
 * Cerut: „un motor mai performant de sortare” — regulile scrise de mână nu știu că omul ăsta
 * păstrează fetița afară și scoate capturile; un model învățat din exemplele lui, da.
 *
 * Cinstit: modelul se folosește doar dacă trece un test pe alegeri pe care nu le-a văzut
 * (validare încrucișată ≥ 70%), altfel nu schimbă nimic.
 */
export interface TasteModel {
  w: number[];
  b: number;
  /** Câte alegeri l-au antrenat. */
  n: number;
  /** Acuratețea pe alegeri nevăzute (validare încrucișată), 0..1. */
  accuracy: number;
  at: number;
}

export interface TasteSample { x: readonly number[]; y: 0 | 1 }

const KEY = 'cp.taste.model.v1';
export const MIN_SAMPLES = 20;
export const MIN_PER_CLASS = 6;
export const MIN_ACCURACY = 0.7;

function normalize(x: readonly number[]): number[] {
  let s = 0;
  for (const v of x) s += v * v;
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  return x.map(v => v * k);
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Antrenare: gradient descendent cu L2, clasele echilibrate (oamenii scot mai mult decât păstrează). */
export function trainLogistic(samples: readonly TasteSample[], epochs = 300, lr = 0.8, l2 = 0.002): { w: number[]; b: number } {
  const d = samples[0]?.x.length ?? 0;
  const xs = samples.map(s => normalize(s.x));
  const pos = samples.filter(s => s.y === 1).length;
  const neg = samples.length - pos;
  const wPos = pos ? samples.length / (2 * pos) : 1;
  const wNeg = neg ? samples.length / (2 * neg) : 1;
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
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / xs.length + l2 * w[j]);
    b -= lr * (gb / xs.length);
  }
  return { w: w.map(v => v * SCALE), b };
}

export function predictTaste(model: Pick<TasteModel, 'w' | 'b'>, x: readonly number[]): number {
  const v = normalize(x);
  let z = model.b;
  for (let j = 0; j < v.length && j < model.w.length; j++) z += model.w[j] * v[j];
  return sigmoid(z);
}

/** Validare încrucișată în k părți: cât de des ghicește alegerile pe care nu le-a văzut. */
export function crossValidate(samples: readonly TasteSample[], k = 5): number {
  if (samples.length < k * 2) return 0;
  // Amestecat determinist, ca rezultatul să nu sară de la o rulare la alta.
  const order = samples.map((_, i) => i).sort((a, b) => ((a * 2654435761) % 1000) - ((b * 2654435761) % 1000));
  let hits = 0;
  for (let f = 0; f < k; f++) {
    const test = order.filter((_, i) => i % k === f).map(i => samples[i]);
    const trainSet = order.filter((_, i) => i % k !== f).map(i => samples[i]);
    if (!trainSet.some(s => s.y === 1) || !trainSet.some(s => s.y === 0)) continue;
    const m = trainLogistic(trainSet, 150);
    for (const s of test) if ((predictTaste(m, s.x) >= 0.5 ? 1 : 0) === s.y) hits++;
  }
  return hits / samples.length;
}

export function buildTasteModel(samples: readonly TasteSample[], now = Date.now()): TasteModel | null {
  const pos = samples.filter(s => s.y === 1).length;
  const neg = samples.length - pos;
  if (samples.length < MIN_SAMPLES || pos < MIN_PER_CLASS || neg < MIN_PER_CLASS) return null;
  const accuracy = crossValidate(samples);
  const { w, b } = trainLogistic(samples);
  return { w, b, n: samples.length, accuracy, at: now };
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
