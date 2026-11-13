import { db } from '../core/db';
import { useStore } from '../state/store';
import { buildTasteModel, predictTaste, readTasteModel, usableTaste, writeTasteModel, type TasteSample } from '../core/learning/personalTaste';

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
    decided.forEach((p, i) => {
      const e = decidedA[i]?.clipEmbedding;
      if (e?.length) samples.push({ x: e, y: p.status === 'selected' ? 1 : 0 });
    });
    const fresh = buildTasteModel(samples);
    if (fresh) writeTasteModel(fresh);
    const model = fresh ?? readTasteModel();
    if (!usableTaste(model)) return { trained: !!fresh, accuracy: (model as { accuracy?: number } | null)?.accuracy ?? 0, n: samples.length, kept: 0, dropped: 0 };

    // Gustul fiecărei poze (și a celor hotărâte), ținut în memorie: „cele mai frumoase” din
    // amintiri, colaje și raportul de dimineață le alege după gustul omului, nu doar după CLIP.
    const all = st.photos;
    const allA = await db.analyses.bulkGet(all.map(p => p.id));
    const tasteById = new Map<string, number>();
    all.forEach((p, i) => { const e = allA[i]?.clipEmbedding; if (e?.length) tasteById.set(p.id, Math.round(predictTaste(model, e) * 1000) / 1000); });
    if (tasteById.size) useStore.setState(s => ({ photos: s.photos.map(p => (tasteById.has(p.id) ? { ...p, tasteP: tasteById.get(p.id) } : p)) }));

    const open = st.photos.filter(p => p.aiDecided !== false && !p.aside);
    const openA = open.map(p => allA[all.indexOf(p)]);
    const keep: string[] = [], toReview: string[] = [], drop: string[] = [];
    open.forEach((p, i) => {
      const e = openA[i]?.clipEmbedding;
      if (!e?.length) return;
      const prob = predictTaste(model, e);
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
    return { trained: !!fresh, accuracy: model.accuracy, n: model.n, kept, dropped };
  } catch {
    return null;
  } finally {
    running = false;
  }
}
