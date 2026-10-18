/**
 * Fețele, după ce coșurile există deja.
 *
 * Pasul rapid nu așteaptă modelele. Aici se reia, în fundal, doar pozele dintr-o
 * rafală sau dintr-un grup de duplicate — singurele pentru care „cel mai bun
 * cadru” are nevoie de ochi. O galerie de 14 poze fără grup nu pornește niciun
 * model. Un import nou anulează rafinarea celui vechi.
 */
import { analysisPool } from './workerPool';
import { db, type AnalysisRecord } from './db';

type Listener = (photoId: string, analysis: AnalysisRecord) => void;
const listeners = new Set<Listener>();
const files = new Map<string, File>();
let generation = 0;

export function subscribeDeepAnalysis(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueDeepAnalysis(items: { id: string; file: File }[]): void {
  const gen = ++generation;
  for (const item of items) files.set(item.id, item.file);
  const ids = items.map(item => item.id);
  if (ids.length === 0) return;
  void run(gen, ids);
}

async function run(gen: number, ids: string[]): Promise<void> {
  try {
    await analysisPool.init();
    const persons = await db.persons.toArray();
    await analysisPool.setKnownPersons(persons);
  } catch {
    return;
  }
  for (const id of ids) {
    if (gen !== generation) return;
    const file = files.get(id);
    if (!file) continue;
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: 640, resizeQuality: 'low' } as ImageBitmapOptions);
      const analysis = await analysisPool.analyze(id, bitmap);
      if (typeof bitmap.close === 'function') bitmap.close();
      if (gen !== generation) return;
      analysis.photoId = id;
      await db.analyses.put(analysis);
      listeners.forEach(listener => listener(id, analysis));
    } catch {
      // Modelul lipsește sau poza nu s-a putut relua. Coșul rapid rămâne.
    }
  }
}
