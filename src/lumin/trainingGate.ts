import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';

/**
 * lumin/trainingGate.ts
 * Înainte să decidă singur pe o galerie mare, AI-ul cere destule exemple.
 *
 * Raportat: „a sortat toată galeria doar din 3/4 decizii — trebuia să ceară mult
 * mai mult”. 295 de poze ajunseseră la „Nu azi” după patru lecții. Acum, sub
 * MIN_LESSONS alegeri ale omului, ce ar arunca AI-ul la citirea galeriei rămâne
 * „de văzut” (nimic nu pleacă), iar pe Azi apare antrenamentul: un pachet
 * variat de poze din galerie, de sortat cu degetul. La prag, AI-ul reia
 * deciziile pe toată biblioteca, cu ce a învățat.
 */
export const MIN_LESSONS = 30;
const REDECIDED_KEY = 'lumin-training-redecided';

export async function countLessons(): Promise<number> {
  try { return await db.corrections.count(); } catch { return 0; }
}

export async function trainedEnough(): Promise<boolean> {
  return (await countLessons()) >= MIN_LESSONS;
}

/** Refuzurile AI-ului din pozele noi devin „de văzut”, cât timp nu e antrenat. */
export async function holdRejectsUntilTrained(ids: string[]): Promise<number> {
  if (!ids.length || await trainedEnough()) return 0;
  return useStore.getState().softenAutoRejects(ids);
}

/**
 * Pozele pentru antrenament: variate, nu doar cele mai bune — de pe tot
 * intervalul de scor (sus, mijloc, jos) și din zile diferite, ca fiecare
 * alegere să învețe ceva nou. Fără documente și fără cele deja decise de om.
 */
export function trainingSample(photos: readonly PhotoView[], n = 20): string[] {
  const pool = photos.filter(p => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate' || p.status === 'rejected'));
  if (pool.length <= n) return pool.map(p => p.id);
  const byScore = [...pool].sort((a, b) => a.aiScore - b.aiScore);
  const out: PhotoView[] = [];
  const seenDays = new Set<number>();
  // Pași egali pe scor; la fiecare pas, o zi încă nefolosită dacă se poate.
  for (let k = 0; k < n; k++) {
    const at = Math.floor(((k + 0.5) / n) * byScore.length);
    const near = byScore.slice(Math.max(0, at - 6), at + 6).filter(p => !out.includes(p));
    const day = (p: PhotoView) => Math.floor((p.capturedAt ?? p.importedAt) / 86_400_000);
    const pick = near.find(p => !seenDays.has(day(p))) ?? near[0];
    if (!pick) continue;
    out.push(pick);
    seenDays.add(day(pick));
  }
  // Amestecat, ca omul să nu vadă întâi toate slabe, apoi toate bune.
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.map(p => p.id);
}

/** La prag: o singură dată, AI-ul reia deciziile pe toată biblioteca. */
export async function redecideIfJustTrained(): Promise<boolean> {
  try { if (localStorage.getItem(REDECIDED_KEY) === '1') return false; } catch { return false; }
  if (!(await trainedEnough())) return false;
  try { localStorage.setItem(REDECIDED_KEY, '1'); } catch { /* fără stocare */ }
  await useStore.getState().rescorePhotos();
  return true;
}
