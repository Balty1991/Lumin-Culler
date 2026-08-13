import { db, type TagMemoryRecord } from '../db';

/**
 * core/learning/tagMemory.ts
 * Ce SUBIECTE pastrezi si ce subiecte arunci.
 *
 * Fratele lui embeddingMemory.ts, dar pentru toate pozele, nu doar pentru cele
 * fara fete: embedding-ul de continut se calculeaza DOAR cand nu exista fete
 * (vezi nativeAnalysis.ts), deci pe portrete si poze de familie — adica pe
 * majoritatea unei galerii de telefon — semnalul acela lipseste cu totul.
 * Etichetele de scena (ML Kit Image Labeling, ~400 concepte: "beach", "dog",
 * "receipt", "screenshot", "food") exista insa la orice poza, si erau folosite
 * pana acum doar la foldere, cautare si protectia documentelor — niciodata la
 * decizie.
 *
 * Model: naive Bayes pe etichete. Pentru fiecare eticheta tinem de cate ori a
 * aparut pe o poza pastrata si pe una respinsa; pentru o poza noua, raportul
 * de verosimilitate al etichetelor ei spune incotro inclina. Cateva sute de
 * numere in total, O(1) per decizie, nicio poza retinuta.
 */

/** De cate ori trebuie sa fi vazut o eticheta (in total) ca sa avem voie sa ne bazam pe ea. */
export const MIN_TAG_OBSERVATIONS = 3;
/** Cate decizii trebuie sa existe de fiecare parte inainte ca semnalul sa conteze deloc. */
export const MIN_DECISIONS = 8;
/** Cate etichete distincte tinem minte, cel mult — plafon de siguranta pentru o taxonomie care ar creste neasteptat. */
const MAX_TAGS = 600;

const ROW_ID = 'current' as const;

function emptyRecord(): TagMemoryRecord {
  return { id: ROW_ID, tags: {}, keptTotal: 0, rejectedTotal: 0, updatedAt: 0 };
}

/**
 * Cat de mult inclina etichetele acestei poze spre "pastrez", 0..1 (0.5 = neutru).
 * null cand inca nu stim destule — apelantul OMITE feature-ul, nu-l trimite ca 0.5
 * (vezi nota despre feature-uri absente vs neutre din ContextEngine).
 */
export function tagAffinity(tags: string[] | undefined, memory: TagMemoryRecord | undefined): number | null {
  if (!tags?.length || !memory) return null;
  if (memory.keptTotal < MIN_DECISIONS || memory.rejectedTotal < MIN_DECISIONS) return null;

  let sum = 0;
  let used = 0;
  for (const tag of tags) {
    const stat = memory.tags[tag];
    if (!stat || stat.kept + stat.rejected < MIN_TAG_OBSERVATIONS) continue;
    // Netezire Laplace: o eticheta vazuta doar de partea pastrata nu produce
    // un raport infinit, doar unul puternic.
    const pKept = (stat.kept + 1) / (memory.keptTotal + 2);
    const pRejected = (stat.rejected + 1) / (memory.rejectedTotal + 2);
    sum += Math.log(pKept / pRejected);
    used++;
  }
  if (!used) return null;

  // Media log-raportului, comprimata in 0..1. tanh, nu clamp: o eticheta foarte
  // dezechilibrata ("receipt", vazuta doar la respinse) trebuie sa apese tare,
  // dar fara sa faca semnalul binar.
  return 0.5 + 0.5 * Math.tanh(sum / used);
}

/** Adauga o decizie la memorie. Fiecare eticheta a pozei primeste un vot de partea deciziei. */
export function accumulateTags(
  memory: TagMemoryRecord | undefined,
  tags: string[] | undefined,
  kept: boolean
): TagMemoryRecord {
  const base = memory ?? emptyRecord();
  if (!tags?.length) return base;

  const next: TagMemoryRecord['tags'] = { ...base.tags };
  for (const tag of new Set(tags)) {
    const stat = next[tag];
    if (!stat && Object.keys(next).length >= MAX_TAGS) continue;
    const current = stat ?? { kept: 0, rejected: 0 };
    next[tag] = kept
      ? { kept: current.kept + 1, rejected: current.rejected }
      : { kept: current.kept, rejected: current.rejected + 1 };
  }

  return {
    ...base,
    tags: next,
    keptTotal: base.keptTotal + (kept ? 1 : 0),
    rejectedTotal: base.rejectedTotal + (kept ? 0 : 1),
    updatedAt: Date.now()
  };
}

export async function readTagMemory(): Promise<TagMemoryRecord | undefined> {
  return db.tagMemory.get(ROW_ID);
}

export async function recordTagDecision(tags: string[] | undefined, kept: boolean): Promise<void> {
  if (!tags?.length) return;
  const current = await readTagMemory();
  await db.tagMemory.put(accumulateTags(current, tags, kept));
}

export async function resetTagMemory(): Promise<void> {
  await db.tagMemory.clear();
}
