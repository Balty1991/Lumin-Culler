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
import { useStore } from '../state/store';

const BATCH = 12;
const PAUSE_MS = 40;
let running = false;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function startClipBackfill(): Promise<void> {
  if (running || !isClipPlatform()) return;
  running = true;
  try {
    if (!(await prepareClip())) return;
    const todo = await db.analyses.filter(a => a.aesthetic === undefined).primaryKeys();
    for (let i = 0; i < todo.length; i += BATCH) {
      const changed = new Map<string, { sceneTags?: string[]; aiScore: number }>();
      for (const id of todo.slice(i, i + BATCH)) {
        while (useStore.getState().progress) await sleep(3000);
        const [photo, analysis] = await Promise.all([db.photos.get(id as string), db.analyses.get(id as string)]);
        if (!photo?.mediaUri || !analysis || analysis.aesthetic !== undefined) continue;
        const clip = await clipAnalyze({ uri: photo.mediaUri, maxSide: 480 });
        if (!clip) { await sleep(PAUSE_MS); continue; }
        const tags = refineTags(analysis.sceneTags, clip.embedding);
        const next = { ...analysis, aesthetic: clip.aesthetic, sceneTags: tags.length ? tags : undefined };
        const prediction = await contextEngine.predict(next, photo.genre);
        next.aiScore = prediction.score;
        next.aiFactors = prediction.topFactors;
        next.aiUncertainty = prediction.uncertainty;
        next.aiPersonalDelta = prediction.personalDelta;
        await db.analyses.put(next);
        changed.set(photo.id, { sceneTags: next.sceneTags, aiScore: next.aiScore });
        await sleep(PAUSE_MS);
      }
      if (changed.size) {
        useStore.setState(s => ({
          photos: s.photos.map(p => {
            const c = changed.get(p.id);
            return c ? { ...p, sceneTags: c.sceneTags, aiScore: c.aiScore } : p;
          })
        }));
      }
    }
  } catch {
    // CLIP e un bonus: dacă ceva nu merge, aplicația rămâne exact ca înainte.
  } finally {
    running = false;
  }
}
