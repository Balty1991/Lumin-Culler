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
  await holdUntilLearned();
  return true;
}

/**
 * Ce fel de poză e, pentru gustul omului. Oamenii și animalele se păstrează singure;
 * mâncarea, locurile și obiectele abia după ce omul a arătat că le păstrează
 * (raportat: cafea, pizza, un dulap și peisaje păstrate de la prima citire —
 * „ar trebui puse în verificare până învață preferințele”).
 */
export type TasteKind = 'people' | 'pet' | 'food' | 'place' | 'thing';
const PET = /^(cat|kitten|dog|puppy|pet|animal|bird|horse|rabbit|hamster|fish)$/i;
const FOOD = /^(food|dish|meal|cuisine|pizza|cake|dessert|coffee|latte|cappuccino|espresso|tea|drink|beverage|cup|mug|breakfast|lunch|dinner|fruit|vegetable|bread|pancake|salad|soup|burger|pasta|sushi|wine|beer|cocktail|baked goods|snack|plate|tableware|cookie|ice cream|chocolate)$/i;
const PLACE = /^(landscape|mountain|lake|sea|beach|ocean|sky|sunset|sunrise|nature|forest|tree|river|waterfall|field|park|garden|city|street|building|architecture|town|road|bridge|church|castle|tower|snow|cloud|hill|desert|valley|skyline|alley|house)$/i;

export function tasteKind(p: Pick<PhotoView, 'faceCount' | 'sceneTags'>): TasteKind {
  if ((p.faceCount ?? 0) > 0) return 'people';
  const tags = p.sceneTags ?? [];
  if (tags.some(t => PET.test(t))) return 'pet';
  if (tags.some(t => FOOD.test(t))) return 'food';
  if (tags.some(t => PLACE.test(t))) return 'place';
  return 'thing';
}

/** Felurile pe care omul le-a păstrat singur de cel puțin 3 ori, mai des decât le-a scos. */
export function learnedKinds(photos: readonly PhotoView[]): Set<TasteKind> {
  const kept = new Map<TasteKind, number>();
  const dropped = new Map<TasteKind, number>();
  for (const p of photos) {
    if (p.aiDecided !== false || p.aside) continue;
    const k = tasteKind(p);
    if (p.status === 'selected') kept.set(k, (kept.get(k) ?? 0) + 1);
    else if (p.status === 'rejected') dropped.set(k, (dropped.get(k) ?? 0) + 1);
  }
  const out = new Set<TasteKind>(['people', 'pet']);
  for (const k of ['food', 'place', 'thing'] as const) {
    const y = kept.get(k) ?? 0, n = dropped.get(k) ?? 0;
    if (y >= 3 && y >= n) out.add(k);
  }
  return out;
}

/** Păstrările AI-ului pentru felurile încă neînvățate devin „de văzut”. Nimic nu se șterge. */
export async function holdUntilLearned(ids?: string[]): Promise<number> {
  // „Decide tot” (Pro): omul a cerut decizii, nu „de văzut” — altfel le-ar scoate pe toate.
  if ((await import('./twin')).readAutonomy() === 'all') return 0;
  const photos = useStore.getState().photos;
  const learned = learnedKinds(photos);
  const only = ids ? new Set(ids) : null;
  const hold = photos.filter(p => (!only || only.has(p.id)) && p.status === 'selected' && p.aiDecided === true && !p.aside && !learned.has(tasteKind(p))).map(p => p.id);
  if (!hold.length) return 0;
  return useStore.getState().softenAutoKeeps(hold);
}
