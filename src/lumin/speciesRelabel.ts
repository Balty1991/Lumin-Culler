/**
 * lumin/speciesRelabel.ts
 * O singură dată: pozele cu o specie de animal în etichete trec din nou prin ML Kit,
 * cu regula nouă (core/nativeImageLabeling.ts, trustedLabels). Etichetele vechi nu au
 * scorurile salvate, iar „Dog” cu 0,6 ajunsese pe aproape toate pozele (raportat).
 * Doar speciile se schimbă; restul etichetelor rămân cum erau.
 */
import { db } from '../core/db';
import { isNativeImageLabelingAvailable, labelImageNative } from '../core/nativeImageLabeling';
import { animalMass, refineTags, SPECIES_SEARCH_AT } from '../core/clip/clipEngine';
import { waitForUserIdle } from '../core/userIdle';
import { useStore } from '../state/store';

const DONE_KEY = 'cherrypic.speciesRelabel.v6';
const SPECIES = /^(dog|cat|bird|horse|rabbit|hamster|cow|sheep|goat|duck|chicken|fish|bear|puppy|kitten)$/i;

/** Etichetele vechi fără specii, plus speciile sigure din etichetarea nouă. */
export function mergeSpecies(old: readonly string[], fresh: readonly string[]): string[] {
  const kept = old.filter(t => !SPECIES.test(t));
  const species = fresh.filter(t => SPECIES.test(t) && !kept.includes(t));
  return [...kept, ...species];
}

/**
 * Fără nicio etichetă ML Kit (ale lui încep cu majusculă; cele CLIP sunt chei mici): în 3.6.1
 * etichetarea cădea în release (R8), deci pozele analizate atunci n-au primit deloc etichete.
 */
export function lacksMlkitLabels(tags: readonly string[] | undefined): boolean {
  return !(tags ?? []).some(t => /^[A-Z]/.test(t));
}

let running = false;
export async function relabelSpeciesOnce(): Promise<void> {
  if (running || !isNativeImageLabelingAvailable()) return;
  try { if (localStorage.getItem(DONE_KEY)) return; } catch { return; }
  running = true;
  try {
    // Și pozele în care CLIP vede un animal, nu doar cele cu o specie în etichete: după
    // pragul prea strict, pisicile adevărate pierduseră eticheta (raportat).
    // Plus pozele rămase fără etichete ML Kit din 3.6.1 (vezi lacksMlkitLabels): primesc tot setul.
    const rows = await db.analyses.filter(a => lacksMlkitLabels(a.sceneTags) || (a.sceneTags ?? []).some(t => SPECIES.test(t))
      || (a.clipEmbedding?.length === 512 && animalMass(a.clipEmbedding) >= SPECIES_SEARCH_AT)).toArray();
    const changed = new Map<string, string[] | undefined>();
    for (const a of rows) {
      const photo = await db.photos.get(a.photoId);
      if (!photo?.mediaUri) continue;
      await waitForUserIdle();
      let fresh: string[];
      try { fresh = (await labelImageNative({ uri: photo.mediaUri, maxSide: 480 })).labels.map(l => l.label); } catch { continue; }
      let tags = lacksMlkitLabels(a.sceneTags) ? [...new Set([...fresh, ...(a.sceneTags ?? [])])] : mergeSpecies(a.sceneTags ?? [], fresh);
      if (a.clipEmbedding?.length === 512) tags = refineTags(tags, a.clipEmbedding);
      const old = a.sceneTags ?? [];
      if (tags.length === old.length && tags.every((t, i) => t === old[i])) continue;
      const next = tags.length ? tags : undefined;
      await db.analyses.update(a.photoId, { sceneTags: next });
      changed.set(a.photoId, next);
    }
    if (changed.size) {
      useStore.setState(s => ({ photos: s.photos.map(p => (changed.has(p.id) ? { ...p, sceneTags: changed.get(p.id) } : p)) }));
    }
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* data viitoare */ }
  } finally {
    running = false;
  }
}
