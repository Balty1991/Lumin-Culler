import { db } from '../core/db';
import { useStore } from '../state/store';
import { blendWithPrior, buildTasteModel, preferModel, readTasteModel, usableTaste, writeTasteModel, type TastePair, type TasteSample } from '../core/learning/personalTaste';
import { readPairs } from '../core/learning/pairs';
import { photoTime } from './days';

/**
 * lumin/tasteApply.ts
 * Modelul de gust personal (core/learning/personalTaste.ts) pus la lucru:
 *  - se antrenează din pozele hotărâte de om (păstrate / scoase) care au amprentă CLIP;
 *  - dacă ghicește bine alegeri nevăzute (≥70%), ajustează deciziile AI-ului:
 *      foarte probabil păstrată (≥85%) și încă „de ales” → păstrată;
 *      foarte probabil scoasă (≤15%), fără oameni → „Nu păstrez” (din „de ales”) sau „de ales” (din păstrate);
 *      cu oameni, niciodată scoasă: cel mult rămâne „de ales”.
 * Deciziile omului nu se ating.
 */
let running = false;

export interface TasteRun { trained: boolean; accuracy: number; n: number; kept: number; dropped: number }

export async function trainAndApplyTaste(): Promise<TasteRun | null> {
  if (running) return null;
  running = true;
  try {
    const st = useStore.getState();
    const decided = st.photos.filter(p => p.aiDecided === false && !p.aside && (p.status === 'selected' || p.status === 'rejected'));
    const decidedA = await db.analyses.bulkGet(decided.map(p => p.id));
    const samples: TasteSample[] = [];
    // Grupul = ziua: validarea nu pune poze din același eveniment și la antrenare și la test.
    const day = (p: (typeof decided)[number]) => { const d = new Date(photoTime(p)); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    decided.forEach((p, i) => {
      const e = decidedA[i]?.clipEmbedding;
      if (e?.length) samples.push({ x: e, y: p.status === 'selected' ? 1 : 0, g: day(p) });
    });
    // Perechile „asta, nu aia” din compararea cadrelor.
    const rawPairs = readPairs();
    const pairIds = [...new Set(rawPairs.flatMap(p => [p.w, p.l]))];
    const pairA = pairIds.length ? await db.analyses.bulkGet(pairIds) : [];
    const embOf = new Map(pairIds.map((id, i) => [id, pairA[i]?.clipEmbedding]));
    const byId = new Map(st.photos.map(p => [p.id, p]));
    const pairs: TastePair[] = [];
    for (const r of rawPairs) {
      const w = embOf.get(r.w), l = embOf.get(r.l);
      const pw = byId.get(r.w);
      if (w?.length && l?.length) pairs.push({ w, l, g: pw ? day(pw) : undefined });
    }
    const stored = readTasteModel();
    const fresh = buildTasteModel(samples, Date.now(), pairs);
    // Modelul nou rulează în umbră: îl înlocuiește pe cel vechi doar dacă e cel puțin la fel de bun.
    const model = fresh ? preferModel(fresh, stored) : stored;
    if (fresh && model === fresh) writeTasteModel(fresh);
    if (!usableTaste(model)) return { trained: !!fresh, accuracy: (model as { accuracy?: number } | null)?.accuracy ?? 0, n: samples.length, kept: 0, dropped: 0 };

    // Gustul fiecărei poze (și a celor hotărâte), ținut în memorie: „cele mai frumoase” din
    // amintiri, colaje și raportul de dimineață le alege după gustul omului, nu doar după CLIP.
    const all = st.photos;
    const allA = await db.analyses.bulkGet(all.map(p => p.id));
    const tasteById = new Map<string, number>();
    all.forEach((p, i) => { const e = allA[i]?.clipEmbedding; if (e?.length) tasteById.set(p.id, Math.round(blendWithPrior(model, e, p.aiScore / 100) * 1000) / 1000); });
    if (tasteById.size) useStore.setState(s => ({ photos: s.photos.map(p => (tasteById.has(p.id) ? { ...p, tasteP: tasteById.get(p.id) } : p)) }));

    const open = st.photos.filter(p => p.aiDecided !== false && !p.aside);
    const openA = open.map(p => allA[all.indexOf(p)]);
    const keep: string[] = [], toReview: string[] = [], drop: string[] = [];
    open.forEach((p, i) => {
      const e = openA[i]?.clipEmbedding;
      if (!e?.length) return;
      const prob = blendWithPrior(model, e, p.aiScore / 100);
      const people = (p.faceCount ?? 0) > 0;
      if (prob >= 0.85 && p.status !== 'selected' && p.allEyesOpen !== false) keep.push(p.id);
      else if (prob <= 0.15 && !people) {
        if (p.status === 'selected') toReview.push(p.id);
        else if (p.status !== 'rejected') drop.push(p.id);
      }
    });
    const kept = keep.length ? await st.promoteAutoPicks(keep) : 0;
    if (toReview.length) await useStore.getState().softenAutoKeeps(toReview);
    const dropped = drop.length ? await useStore.getState().demoteAutoPicks(drop) : 0;
    return { trained: !!fresh && model === fresh, accuracy: model.accuracy, n: model.n, kept, dropped };
  } catch {
    return null;
  } finally {
    running = false;
  }
}
