import { db, type EmbeddingMemoryRecord } from '../db';

/**
 * core/learning/embeddingMemory.ts
 * Memoria de CONTINUT: cu ce seamana pozele pe care le pastrezi, fata de cele
 * pe care le arunci.
 *
 * Restul motorului (ContextEngine) invata despre CALITATE — claritate,
 * expunere, zambete, compozitie. Nu are niciun semnal despre SUBIECT: nu poate
 * invata ca tii pozele cu cainele si arunci capturile de ecran, pentru ca
 * niciunul dintre cele ~35 de feature-uri nu descrie ce e in poza.
 *
 * Embedding-ul de 1024 de dimensiuni exista deja pentru fiecare poza fara fete
 * (AnalysisRecord.imageEmbedding, MediaPipe Image Embedder pe Android) si era
 * folosit exclusiv la detectia de duplicate. Aici devine si semnal de decizie,
 * fara niciun cost nou de analiza.
 *
 * Cum: doua centroide (media embeddingurilor pastrate, media celor respinse).
 * Pentru o poza noua, `affinity()` compara cat de aproape e de fiecare. Nu se
 * retine nicio poza individuala — doar suma si numarul, deci memoria e O(1) si
 * nu creste cu biblioteca.
 *
 * DELIBERAT neutru pana la MIN_SAMPLES decizii de fiecare parte: cu 2-3 poze,
 * o centroida e zgomot, iar un semnal zgomotos care intra in scor e mai rau
 * decat niciun semnal.
 */

/** Cate decizii de FIECARE parte trebuie sa existe inainte ca semnalul sa conteze. */
export const MIN_SAMPLES = 5;

const ROW_ID = 'current' as const;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function centroid(sum: number[], count: number): number[] | null {
  if (count <= 0 || !sum.length) return null;
  return sum.map(v => v / count);
}

/**
 * Cat de mult seamana o poza cu ce ai pastrat, fata de ce ai respins.
 * 0..1, unde 0.5 = neutru (nu stim, sau la fel de aproape de ambele).
 * Intoarce null cand nu exista inca destule decizii — apelantul trebuie sa
 * OMITA feature-ul cu totul, nu sa-l trimita ca 0.5 (vezi nota despre
 * feature-uri absente vs neutre din ContextEngine).
 */
export function affinity(embedding: number[], memory: EmbeddingMemoryRecord | undefined): number | null {
  if (!memory || !embedding.length) return null;
  if (memory.keptCount < MIN_SAMPLES || memory.rejectedCount < MIN_SAMPLES) return null;
  const kept = centroid(memory.keptSum, memory.keptCount);
  const rejected = centroid(memory.rejectedSum, memory.rejectedCount);
  if (!kept || !rejected) return null;
  // Diferenta de similaritate cosinus, in [-2, 2], adusa in [0, 1]. In practica
  // embeddingurile din aceeasi familie de continut stau intr-un con stramt, deci
  // diferenta reala e mica — de aceea o amplificam inainte de clamp, altfel
  // semnalul ar fi mereu ~0.5 si modelul n-ar avea ce invata din el.
  const delta = cosine(embedding, kept) - cosine(embedding, rejected);
  return Math.max(0, Math.min(1, 0.5 + delta * 2));
}

/** Adauga o decizie la memorie. Media e incrementala: nicio poza nu e retinuta. */
export function accumulate(
  memory: EmbeddingMemoryRecord | undefined,
  embedding: number[],
  kept: boolean
): EmbeddingMemoryRecord {
  const base: EmbeddingMemoryRecord = memory ?? {
    id: ROW_ID, keptSum: [], keptCount: 0, rejectedSum: [], rejectedCount: 0, updatedAt: 0
  };
  const sum = kept ? base.keptSum : base.rejectedSum;
  const next = sum.length === embedding.length
    ? sum.map((v, i) => v + embedding[i])
    : [...embedding]; // prima poza de partea asta (sau dimensiune schimbata de model) — repornim suma
  const count = (sum.length === embedding.length ? (kept ? base.keptCount : base.rejectedCount) : 0) + 1;

  return {
    ...base,
    ...(kept ? { keptSum: next, keptCount: count } : { rejectedSum: next, rejectedCount: count }),
    updatedAt: Date.now()
  };
}

export async function readEmbeddingMemory(): Promise<EmbeddingMemoryRecord | undefined> {
  return db.embeddingMemory.get(ROW_ID);
}

export async function recordEmbeddingDecision(embedding: number[] | undefined, kept: boolean): Promise<void> {
  if (!embedding?.length) return;
  const current = await readEmbeddingMemory();
  await db.embeddingMemory.put(accumulate(current, embedding, kept));
}

export async function resetEmbeddingMemory(): Promise<void> {
  await db.embeddingMemory.clear();
}
