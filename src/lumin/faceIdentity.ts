import { registerPlugin, Capacitor } from '@capacitor/core';
import { db } from '../core/db';
import { useStore } from '../state/store';

/**
 * lumin/faceIdentity.ts
 * Cine e în poză, pe telefon, cu un model care are voie în Play: SFace
 * (Apache-2.0, plugins/FaceEmbedPlugin.kt). Trei pași:
 * 1. amprenta fiecărei fețe încă fără amprentă (în fundal, câte o poză);
 * 2. fețele fără nume, grupate după asemănare — „Cine e? (12 poze)”;
 * 3. fețele noi care seamănă clar cu cineva numit primesc numele singure.
 *
 * Amprenta se ține pe fața din analiză (`embedding`), marcată cu modelul ei
 * (`embeddingModel: 'sface'`), ca să nu se amestece cu amprentele altui model.
 */
interface FaceEmbedApi {
  embedFaces(options: { uri: string; boxes: [number, number, number, number][] }): Promise<{ embeddings: number[][] }>;
}
const FaceEmbed = registerPlugin<FaceEmbedApi>('FaceEmbed');

export const MODEL = 'sface';
/** Două fețe la peste atât (cosinus) sunt, foarte probabil, același om. */
export const SAME_PERSON = 0.42;
/** Recunoașterea automată cere mai mult: un nume greșit e mai rău decât niciunul. */
export const AUTO_NAME = 0.5;
const AUTO_MARGIN = 0.06;
/** Fețe prea mici dau amprente nesigure. */
const MIN_FACE_AREA = 0.004;

type Face = { box: [number, number, number, number]; personId: string | null; personName?: string; embedding?: number[]; embeddingModel?: string };

export function canEmbedFaces(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FaceEmbed');
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface FaceRef { photoId: string; faceIndex: number; box: [number, number, number, number]; embedding: number[] }

/** Grupare simplă: fiecare față intră în grupul cu media cea mai apropiată, peste prag. */
export function clusterFaces(faces: readonly FaceRef[], threshold = SAME_PERSON): FaceRef[][] {
  const groups: { members: FaceRef[]; sum: number[] }[] = [];
  for (const f of faces) {
    let best: { g: (typeof groups)[number]; s: number } | null = null;
    for (const g of groups) {
      const s = cosine(f.embedding, g.sum);
      if (s >= threshold && (!best || s > best.s)) best = { g, s };
    }
    if (best) {
      best.g.members.push(f);
      for (let i = 0; i < f.embedding.length; i++) best.g.sum[i] += f.embedding[i];
    } else {
      groups.push({ members: [f], sum: [...f.embedding] });
    }
  }
  return groups.map(g => g.members).sort((a, b) => b.length - a.length);
}

/** Toate fețele cu amprentă SFace, cu sau fără nume. */
export async function readSfaceFaces(): Promise<{ named: Map<string, number[][]>; unnamed: FaceRef[] }> {
  const analyses = await db.analyses.toArray();
  const named = new Map<string, number[][]>();
  const unnamed: FaceRef[] = [];
  for (const a of analyses) {
    (a.faces as Face[] | undefined ?? []).forEach((f, faceIndex) => {
      if (f.embeddingModel !== MODEL || !f.embedding?.length) return;
      if (f.personId) {
        const list = named.get(f.personId) ?? [];
        list.push(f.embedding);
        named.set(f.personId, list);
      } else {
        unnamed.push({ photoId: a.photoId, faceIndex, box: f.box, embedding: f.embedding });
      }
    });
  }
  return { named, unnamed };
}

let running: Promise<number> | null = null;

/**
 * Calculează amprentele lipsă. Întoarce câte fețe noi au primit amprentă.
 * O singură rulare odată; poate fi chemată oricând (după import, la Oameni).
 */
export function embedMissingFaces(onProgress?: (done: number, total: number) => void): Promise<number> {
  if (!canEmbedFaces()) return Promise.resolve(0);
  running ??= (async () => {
    const [photos, analyses] = await Promise.all([db.photos.toArray(), db.analyses.toArray()]);
    const uri = new Map(photos.map(p => [p.id, p.mediaUri]));
    const todo = analyses.filter(a => uri.get(a.photoId) && (a.faces as Face[] | undefined ?? [])
      .some(f => f.embeddingModel !== MODEL && f.box[2] * f.box[3] >= MIN_FACE_AREA));
    let made = 0;
    for (let i = 0; i < todo.length; i++) {
      const a = todo[i];
      const faces = a.faces as Face[];
      const idx = faces.map((f, k) => (f.embeddingModel !== MODEL && f.box[2] * f.box[3] >= MIN_FACE_AREA ? k : -1)).filter(k => k >= 0);
      try {
        const r = await FaceEmbed.embedFaces({ uri: uri.get(a.photoId)!, boxes: idx.map(k => faces[k].box) });
        idx.forEach((k, j) => {
          const e = r.embeddings[j];
          // Și o încercare ratată se marchează, ca să nu se reia la nesfârșit.
          faces[k] = { ...faces[k], embedding: e?.length ? e : faces[k].embedding, embeddingModel: MODEL };
          if (e?.length) made++;
        });
        await db.analyses.update(a.photoId, { faces: faces as typeof a.faces });
      } catch {
        // o poză care nu se mai poate citi nu oprește restul
      }
      onProgress?.(i + 1, todo.length);
    }
    return made;
  })().finally(() => { running = null; });
  return running;
}

/**
 * Fețele fără nume care seamănă clar cu cineva numit primesc numele lui.
 * Întoarce câte fețe au fost recunoscute.
 */
export async function autoNameFaces(): Promise<number> {
  const { named, unnamed } = await readSfaceFaces();
  if (!named.size || !unnamed.length) return 0;
  const persons = useStore.getState().persons;
  const centroids = [...named.entries()].map(([id, list]) => {
    const sum = new Array(list[0].length).fill(0);
    for (const e of list) for (let i = 0; i < e.length; i++) sum[i] += e[i];
    return { id, name: persons.find(p => p.id === id)?.name, sum };
  }).filter((c): c is { id: string; name: string; sum: number[] } => !!c.name);
  const byName = new Map<string, FaceRef[]>();
  for (const f of unnamed) {
    const scored = centroids.map(c => ({ c, s: cosine(f.embedding, c.sum) })).sort((x, y) => y.s - x.s);
    const [best, second] = scored;
    if (!best || best.s < AUTO_NAME || (second && best.s - second.s < AUTO_MARGIN)) continue;
    const list = byName.get(best.c.name) ?? [];
    list.push(f);
    byName.set(best.c.name, list);
  }
  let total = 0;
  for (const [name, faces] of byName) {
    await useStore.getState().enrollFaceCluster(name, faces.map(f => ({ photoId: f.photoId, faceIndex: f.faceIndex, embedding: f.embedding })));
    total += faces.length;
  }
  return total;
}
