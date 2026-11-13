/**
 * core/clip/clipEngine.ts
 * CLIP ViT-B/32 pe telefon (ClipPlugin.kt): din cele 512 numere ale unei poze
 * scoatem două lucruri, fără server:
 *
 *  - un scor estetic pe scara 1–10, din perechile CLIP-IQA de mai jos (doar CLIP,
 *    licență MIT; capul LAION, cu date de antrenare neclare, a ieșit din aplicație);
 *  - etichete zero-shot: comparăm poza cu descrieri scrise („a photo of a teddy
 *    bear”), ale căror embedding-uri sunt calculate o dată, în CI, și puse în
 *    clipLabels.json. Așa deosebim ursulețul de pluș de câine, apusul de amiază.
 *
 * Etichetele ML Kit rămân; CLIP doar adaugă ce vede sigur și scoate animalele
 * pe care nu le vede deloc (raportat: copii și jucării în „Animale”).
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { nativeImageParams, type NativeImageParams, type NativeImageSource } from '../nativeImageSource';
import data from './clipLabels.json';

interface ClipPluginApi {
  available(): Promise<{ ready: boolean; wifi: boolean; textReady?: boolean }>;
  prepare(o?: { anyNetwork?: boolean }): Promise<{ ready: boolean; reason?: string }>;
  embed(o: NativeImageParams): Promise<{ embedding: number[] }>;
  prepareText(o?: { anyNetwork?: boolean }): Promise<{ ready: boolean; reason?: string }>;
  embedText(o: { text: string }): Promise<{ pooled: number[] }>;
}

export const ClipNative = registerPlugin<ClipPluginApi>('Clip');

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

const DIM = 512;
let tables: { keys: string[]; text: Float32Array; qkeys: string[]; q: Float32Array } | null = null;
function halves(s: string): Float32Array {
  const raw = b64(s);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = half(u16[i]);
  return out;
}
function load() {
  if (tables) return tables;
  tables = { keys: data.keys, text: halves(data.text), qkeys: data.qkeys, q: halves(data.q) };
  return tables;
}

/**
 * Scorul estetic (≈3,5–7,5 pe scara 1–10, ca vechiul LAION, ca restul motorului să nu se mute):
 * cât de clară, bine expusă, reușită și intenționată pare poza, din perechile CLIP-IQA.
 * Fără strat antrenat pe date terțe: doar CLIP (MIT) și descrieri scrise de noi.
 */
export function aestheticOf(e: ArrayLike<number>): number {
  const { parts } = qualityOf(e);
  const keys = ['sharp', 'exposure', 'quality', 'accident'].filter(k => parts[k] !== undefined);
  const m = keys.reduce((a, k) => a + parts[k], 0) / Math.max(1, keys.length);
  return Math.round((3.5 + 4 * m) * 100) / 100;
}

/**
 * CLIP-IQA: pentru fiecare pereche („poză clară” / „poză mișcată”, „bine
 * expusă” / „întunecată”, „poză bună” / „poză proastă”) cât de mult înclină
 * poza spre partea bună, 0..1. Testat în CI: aceeași cameră estompată coboară
 * de la 0,55 la 0,09, întunecată la 0,27. E relativ, nu absolut — de aceea
 * intră în motor normalizat, ca orice alt semnal.
 */
export function qualityOf(e: ArrayLike<number>): { score: number; parts: Record<string, number> } {
  const t = load();
  const parts: Record<string, number> = {};
  t.qkeys.forEach((key, k) => {
    let good = 0, bad = 0;
    for (let i = 0; i < DIM; i++) { good += e[i] * t.q[(2 * k) * DIM + i]; bad += e[i] * t.q[(2 * k + 1) * DIM + i]; }
    parts[key] = 1 / (1 + Math.exp(-(good - bad) * 100));
  });
  const used = ['sharp', 'exposure', 'quality'].filter(k => parts[k] !== undefined);
  const score = used.reduce((a, k) => a + parts[k], 0) / Math.max(1, used.length);
  return { score: Math.round(score * 1000) / 1000, parts };
}

/** Probabilitatea fiecărei etichete (softmax cu scala CLIP 100). */
export function zeroShot(e: ArrayLike<number>): { key: string; p: number }[] {
  const t = load();
  const logits = t.keys.map((_, k) => {
    let d = 0;
    for (let i = 0; i < DIM; i++) d += e[i] * t.text[k * DIM + i];
    return d * 100;
  });
  const m = Math.max(...logits);
  const ex = logits.map(l => Math.exp(l - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  return t.keys.map((key, k) => ({ key, p: ex[k] / sum })).sort((a, b) => b.p - a.p);
}

/**
 * Ce a învățat modelul de gust personal, în cuvinte: direcția învățată (w) comparată cu
 * descrierile CLIP ale etichetelor. Pozitive = ce păstrează omul, negative = ce scoate.
 * Cheile cu „-” sunt doar repere și nu se spun.
 */
export function tasteConcepts(w: ArrayLike<number>): { key: string; score: number }[] {
  const t = load();
  let wn = 0;
  for (let i = 0; i < DIM; i++) wn += w[i] * w[i];
  wn = Math.sqrt(wn) || 1;
  return t.keys.map((key, k) => {
    let d = 0;
    for (let i = 0; i < DIM; i++) d += w[i] * t.text[k * DIM + i];
    return { key, score: d / wn };
  }).filter(x => !x.key.includes('-')).sort((a, b) => b.score - a.score);
}

const ANIMALS = new Set(['dog', 'cat', 'bird', 'horse', 'bear', 'cow', 'sheep', 'duck', 'fish', 'elephant']);
/** Etichetele ML Kit de animale (vezi smartFolders „pets”). */
const ANIMAL_TAGS = new Set(['cat', 'dog', 'bird', 'horse', 'kitten', 'puppy', 'rabbit', 'hamster', 'parrot', 'cow', 'sheep', 'goat', 'duck', 'chicken', 'fish', 'pet', 'animal']);
/** Cât de sigur trebuie să fie CLIP ca să adauge o etichetă proprie (testat în CI pe poze COCO). */
const ADD_AT = 0.5;
/** Etichetele care mută poza deoparte sau o fac „document”: doar când e foarte sigur. */
const STRICT = new Set(['screenshot', 'meme', 'document', 'receipt']);
const STRICT_AT = 0.75;

/**
 * Etichetele finale: ale lui ML Kit, fără animalele pe care CLIP nu le vede
 * deloc, plus cel mult două etichete CLIP sigure. Cheile cu „-” sunt doar
 * repere (oameni/obiect generic) și nu devin etichete.
 */
export function refineTags(mlkit: readonly string[] | undefined, e: ArrayLike<number>): string[] {
  const ranked = zeroShot(e);
  const animalP = ranked.filter(r => ANIMALS.has(r.key)).reduce((a, r) => a + r.p, 0);
  const pOf = (key: string) => ranked.find(r => r.key === key)?.p ?? 0;
  const catP = pOf('cat'), dogP = pOf('dog');
  // Pisică sau câine: ML Kit le confundă (raportat: „poze cu câini” arăta pisici, iar o
  // pătură moale dădea „pisică”). Specia rămâne doar dacă CLIP n-o vede clar pe cealaltă.
  const wrongSpecies = (tag: string) => {
    const t = tag.toLowerCase();
    if (t === 'cat' || t === 'kitten') return catP < 0.05 && (dogP > catP * 3 || animalP < 0.15);
    if (t === 'dog' || t === 'puppy') return dogP < 0.05 && (catP > dogP * 3 || animalP < 0.15);
    return false;
  };
  const out = (mlkit ?? []).filter(tag => !(ANIMAL_TAGS.has(tag.toLowerCase()) && animalP < 0.08) && !wrongSpecies(tag));
  const have = new Set(out.map(tag => tag.toLowerCase()));
  for (const r of ranked.slice(0, 2)) {
    if (r.p < (STRICT.has(r.key) ? STRICT_AT : ADD_AT) || r.key.startsWith('-') || have.has(r.key)) continue;
    out.push(r.key);
    have.add(r.key);
  }
  return out;
}

export function isClipPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Clip');
}

let readyCache: boolean | null = null;
/** Modelul e pe telefon? (rapid, ținut minte; nu descarcă nimic) */
export async function clipReady(): Promise<boolean> {
  if (readyCache !== null) return readyCache;
  if (!isClipPlatform()) return false;
  try { readyCache = (await ClipNative.available()).ready; } catch { readyCache = false; }
  return readyCache;
}

/** Descarcă modelul dacă lipsește — implicit doar pe Wi-Fi. */
export async function prepareClip(anyNetwork = false): Promise<boolean> {
  if (!isClipPlatform()) return false;
  try {
    const r = await ClipNative.prepare({ anyNetwork });
    readyCache = r.ready;
    return r.ready;
  } catch { return false; }
}

export interface ClipResult { aesthetic: number; quality: number; embedding: number[] }

export async function clipAnalyze(source: NativeImageSource): Promise<ClipResult | null> {
  if (!(await clipReady())) return null;
  try {
    const { embedding } = await ClipNative.embed(await nativeImageParams(source));
    if (embedding?.length !== DIM) return null;
    return { aesthetic: aestheticOf(embedding), quality: qualityOf(embedding).score, embedding };
  } catch { return null; }
}
