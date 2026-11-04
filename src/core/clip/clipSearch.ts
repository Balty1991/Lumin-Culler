/**
 * core/clip/clipSearch.ts
 * Căutare în cuvinte proprii, în orice limbă: „copii la mare la apus”.
 *
 * Textul trece prin modelul multilingv clip-ViT-B-32-multilingual-v1
 * (sentence-transformers, Apache-2.0), antrenat să ajungă în ACELAȘI spațiu ca
 * imaginile CLIP ViT-B/32 pe care le avem deja la fiecare poză. Pe telefon:
 * tokenizare + model în ClipPlugin.kt (media pe cuvinte), apoi stratul Dense
 * (768 → 512, extras în CI în clipDense.json) aici. Nicio poză și niciun cuvânt
 * nu pleacă de pe telefon.
 */
import { db } from '../db';
import { ClipNative as ClipText, isClipPlatform } from './clipEngine';

let dense: { w: Float32Array; out: number; inp: number } | null = null;
async function loadDense() {
  if (dense) return dense;
  const data = (await import('./clipDense.json')).default as { w: string; shape: [number, number] };
  const bin = atob(data.w);
  const u16 = new Uint16Array(bin.length / 2);
  for (let i = 0; i < u16.length; i++) u16[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
  const w = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    w[i] = e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  dense = { w, out: data.shape[0], inp: data.shape[1] };
  return dense;
}

/** Stratul Dense (fără bias, fără activare) + normalizare. */
export function project(pooled: ArrayLike<number>, d: { w: Float32Array; out: number; inp: number }): Float32Array {
  const e = new Float32Array(d.out);
  let n = 0;
  for (let o = 0; o < d.out; o++) {
    let z = 0;
    for (let i = 0; i < d.inp; i++) z += d.w[o * d.inp + i] * pooled[i];
    e[o] = z; n += z * z;
  }
  n = Math.sqrt(n) || 1;
  for (let o = 0; o < d.out; o++) e[o] /= n;
  return e;
}

let textReadyCache: boolean | null = null;
export async function clipSearchReady(): Promise<boolean> {
  if (textReadyCache !== null) return textReadyCache;
  if (!isClipPlatform()) return (textReadyCache = false);
  try { textReadyCache = !!(await ClipText.available()).textReady; } catch { textReadyCache = false; }
  return textReadyCache;
}

/** Descarcă modelul de căutare (o dată, pe Wi-Fi implicit). */
export async function prepareClipSearch(anyNetwork = false): Promise<boolean> {
  if (!isClipPlatform()) return false;
  try {
    const r = await ClipText.prepareText({ anyNetwork });
    textReadyCache = r.ready;
    return r.ready;
  } catch { return false; }
}

let index: { ids: string[]; vecs: number[][]; at: number } | null = null;
async function loadIndex() {
  if (index && Date.now() - index.at < 60_000) return index;
  const ids: string[] = [], vecs: number[][] = [];
  await db.analyses.each(a => {
    if (a.clipEmbedding?.length === 512) { ids.push(a.photoId); vecs.push(a.clipEmbedding); }
  });
  index = { ids, vecs, at: Date.now() };
  return index;
}

/**
 * Pozele care se potrivesc cu textul, cele mai potrivite întâi. Pragul e relativ
 * la cea mai bună potrivire (scorurile CLIP text↔imagine stau strâns, ~0,2–0,35),
 * cu o podea absolută ca o căutare fără sens să nu întoarcă toată galeria.
 */
export async function clipSearch(query: string, limit = 120): Promise<string[]> {
  const q = query.trim();
  if (q.length < 3 || !(await clipSearchReady())) return [];
  try {
    // „o fotografie cu …”: CLIP a învățat din descrieri de poze, nu din cuvinte izolate.
    const [{ pooled }, d, idx] = await Promise.all([ClipText.embedText({ text: `o fotografie cu ${q}` }), loadDense(), loadIndex()]);
    if (!idx.ids.length) return [];
    const t = project(pooled, d);
    const scored = idx.vecs.map((v, i) => {
      let s = 0;
      for (let k = 0; k < 512; k++) s += v[k] * t[k];
      return { id: idx.ids[i], s };
    }).sort((a, b) => b.s - a.s);
    const best = scored[0].s;
    const floor = Math.max(FLOOR, best - BAND);
    return scored.filter(x => x.s >= floor).slice(0, limit).map(x => x.id);
  } catch {
    return [];
  }
}

/** Calibrate în CI pe poze COCO: potrivirea corectă ~0,28–0,32, celelalte ≤0,23. */
export const FLOOR = 0.265;
export const BAND = 0.03;
