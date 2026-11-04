/**
 * core/clip/clipEngine.ts
 * CLIP ViT-B/32 pe telefon (ClipPlugin.kt): din cele 512 numere ale unei poze
 * scoatem două lucruri, fără server:
 *
 *  - scorul estetic LAION (aesthetic-predictor, MIT): un strat liniar peste
 *    embedding, pe scara 1–10 (poze de telefon obișnuite: ~4–6,5);
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
  available(): Promise<{ ready: boolean; wifi: boolean }>;
  prepare(o?: { anyNetwork?: boolean }): Promise<{ ready: boolean; reason?: string }>;
  embed(o: NativeImageParams): Promise<{ embedding: number[] }>;
}

const ClipNative = registerPlugin<ClipPluginApi>('Clip');

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
let tables: { keys: string[]; text: Float32Array; aw: Float32Array; ab: number } | null = null;
function load() {
  if (tables) return tables;
  const raw = b64(data.text);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const text = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) text[i] = half(u16[i]);
  const awb = b64(data.aw);
  tables = { keys: data.keys, text, aw: new Float32Array(awb.buffer, awb.byteOffset, DIM), ab: data.ab };
  return tables;
}

/** Scorul estetic LAION (1–10) pentru un embedding normalizat. */
export function aestheticOf(e: ArrayLike<number>): number {
  const t = load();
  let z = t.ab;
  for (let i = 0; i < DIM; i++) z += e[i] * t.aw[i];
  return Math.round(z * 100) / 100;
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
  const out = (mlkit ?? []).filter(tag => !(ANIMAL_TAGS.has(tag.toLowerCase()) && animalP < 0.08));
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

export interface ClipResult { aesthetic: number; embedding: number[] }

export async function clipAnalyze(source: NativeImageSource): Promise<ClipResult | null> {
  if (!(await clipReady())) return null;
  try {
    const { embedding } = await ClipNative.embed(await nativeImageParams(source));
    if (embedding?.length !== DIM) return null;
    return { aesthetic: aestheticOf(embedding), embedding };
  } catch { return null; }
}
