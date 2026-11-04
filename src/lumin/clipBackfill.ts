/**
 * lumin/clipBackfill.ts
 * După ce modelul CLIP ajunge pe telefon (o dată, pe Wi-Fi), trece în liniște și
 * prin pozele analizate înainte: scor estetic + etichete mai sigure. Nu schimbă
 * nicio decizie (păstrat/respins) — doar scorul AI și etichetele, deci căutarea,
 * dosarele și „cea mai bună poză” devin mai bune fără să mute nimic sub ochii omului.
 *
 * Merge câte o poză, cu pauze, și stă cât timp rulează un import.
 */
import { db } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { clipAnalyze, prepareClip, refineTags, isClipPlatform } from '../core/clip/clipEngine';
import { downloadModels, getModelsState, setModelsState } from './aiModels';
import { useStore } from '../state/store';

const BATCH = 12;
const PAUSE_MS = 40;
let running = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startClipBackfill(anyNetwork = false): Promise<void> {
  if (running || !isClipPlatform()) return;
  running = true;
  try {
    // Ambele modele întâi (cu progres în Setări), apoi trecerea prin poze.
    await downloadModels(anyNetwork);
    if (!getModelsState().visionReady && !(await prepareClip(anyNetwork))) return;
    const todo = await db.analyses.filter(a => a.clipEmbedding === undefined).primaryKeys();
    setModelsState({ phase: 'scanning', scanned: 0, toScan: todo.length });
    for (let i = 0; i < todo.length; i += BATCH) {
      const changed = new Map<string, { sceneTags?: string[]; aiScore: number; aesthetic: number }>();
      for (const id of todo.slice(i, i + BATCH)) {
        while (useStore.getState().progress) await sleep(3000);
        const [photo, analysis] = await Promise.all([db.photos.get(id as string), db.analyses.get(id as string)]);
        if (!photo?.mediaUri || !analysis || analysis.clipEmbedding !== undefined) continue;
        const clip = await clipAnalyze({ uri: photo.mediaUri, maxSide: 480 });
        if (!clip) { await sleep(PAUSE_MS); continue; }
        const tags = refineTags(analysis.sceneTags, clip.embedding);
        const next = { ...analysis, aesthetic: clip.aesthetic, clipEmbedding: clip.embedding, clipQuality: clip.quality, sceneTags: tags.length ? tags : undefined };
        const prediction = await contextEngine.predict(next, photo.genre);
        next.aiScore = prediction.score;
        next.aiFactors = prediction.topFactors;
        next.aiUncertainty = prediction.uncertainty;
        next.aiPersonalDelta = prediction.personalDelta;
        await db.analyses.put(next);
        changed.set(photo.id, { sceneTags: next.sceneTags, aiScore: next.aiScore, aesthetic: clip.aesthetic });
        await sleep(PAUSE_MS);
      }
      setModelsState({ scanned: Math.min(todo.length, i + BATCH) });
      if (changed.size) {
        useStore.setState(s => ({
          photos: s.photos.map(p => {
            const c = changed.get(p.id);
            return c ? { ...p, sceneTags: c.sceneTags, aiScore: c.aiScore, aesthetic: c.aesthetic } : p;
          })
        }));
      }
    }
    setModelsState({ phase: getModelsState().textReady ? 'ready' : getModelsState().phase === 'scanning' ? 'idle' : getModelsState().phase });
  } catch {
    // CLIP e un bonus: dacă ceva nu merge, aplicația rămâne exact ca înainte.
  } finally {
    running = false;
  }
}

/**
 * După fiecare import (bara de progres dispare), pozele noi trec prin CLIP în
 * fundal. Așa importul rămâne la fel de rapid ca înainte de CLIP.
 */
let watching = false;
export function watchImportsForClip(): void {
  if (watching || !isClipPlatform()) return;
  watching = true;
  let was = !!useStore.getState().progress;
  useStore.subscribe(st => {
    const now = !!st.progress;
    if (was && !now) window.setTimeout(() => { void startClipBackfill(); }, 1500);
    was = now;
  });
}
