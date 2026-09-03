/**
 * core/clip/clipVector.ts
 * Matematica vectorilor CLIP — si singurul loc din care se compara doi.
 *
 * REGULA CENTRALA, si motivul pentru care fisierul asta exista separat:
 * doi vectori produsi de modele diferite NU se compara niciodata. Nu pentru ca
 * ar da eroare — tocmai asta e problema. Cosinusul dintre un vector MobileCLIP
 * si unul MobileNetV3 e un numar perfect valid, intre -1 si 1, care arata exact
 * ca un raspuns bun si nu inseamna absolut nimic. E cel mai urat fel de bug
 * posibil in aplicatia asta: nimic nu crapa, nimeni nu vede o eroare, si toate
 * raspunsurile devin gresite in tacere — "poze similare" intoarce poze la
 * intamplare, iar motorul "invata" din zgomot.
 *
 * Scenariul nu e teoretic: aplicatia ARE deja un al doilea spatiu de embedding
 * (AnalysisRecord.imageEmbedding, MobileNetV3 pe Android), si va avea un al
 * treilea in ziua in care se schimba modelul CLIP. De-aia fiecare vector isi
 * poarta cu el `modelId`, iar comparatia il cere pe amandoua si refuza cand nu
 * sunt identice.
 *
 * Refuzul e `null`, nu o exceptie: apelantii sunt ecrane ("poze similare",
 * cautare), iar raspunsul corect acolo e "nu pot raspunde la asta", nu o
 * fereastra de eroare.
 */

/** Un vector cu identitatea modelului care l-a produs lipita de el. Nu se despart niciodata. */
export interface ClipVector {
  /** Vezi ClipManifest.id — identitatea exacta, cu cuantizare si revizie. */
  modelId: string;
  /** Deja normalizat L2 (vezi normalize) — invariant, ca sa nu se renormalizeze la fiecare comparatie. */
  values: Float32Array;
}

/**
 * Normalizeaza la lungime 1. Cu vectori normalizati, cosinusul e un simplu
 * produs scalar — si toate pragurile devin comparabile intre ele.
 *
 * Un vector de lungime 0 (poza complet neagra printr-un model degenerat, sau
 * un bug de preprocesare) ramane zero in loc sa devina NaN: un zero se vede la
 * comparatie ca "similaritate 0", pe cand un NaN se propaga tacut prin sortari.
 */
export function normalize(values: Float32Array): Float32Array {
  let sum = 0;
  for (const v of values) sum += v * v;
  const len = Math.sqrt(sum);
  if (!(len > 0) || !Number.isFinite(len)) return new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / len;
  return out;
}

/**
 * Cat de asemanatoare sunt doua poze, intre -1 si 1. `null` cand intrebarea
 * n-are sens: modele diferite, sau lungimi diferite.
 *
 * Lungimea se verifica separat de `modelId` fiindca un fisier de model stricat
 * poate da acelasi id si alta dimensiune — iar o bucla peste doua lungimi
 * diferite ar citi in gol si ar intoarce un numar, nu o eroare.
 */
export function cosine(a: ClipVector, b: ClipVector): number | null {
  if (a.modelId !== b.modelId) return null;
  if (a.values.length !== b.values.length || a.values.length === 0) return null;
  let dot = 0;
  for (let i = 0; i < a.values.length; i++) dot += a.values[i] * b.values[i];
  // Plafonat: acumularea in virgula mobila poate da 1.0000001 pe doi vectori
  // identici, iar un scor "peste 1" arata a bug oriunde ar fi afisat.
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Centroida unui set de vectori, renormalizata — "cam ce fel de poze sunt
 * astea". Asta face posibil, in sfarsit, ce incearca deja EmbeddingMemoryRecord
 * (core/db.ts): centroida pozelor pastrate fata de cea a pozelor aruncate.
 *
 * Intoarce `null` pentru un set gol sau amestecat: media a doua spatii diferite
 * n-ar fi doar inexacta, ar fi lipsita de sens.
 */
export function centroid(vectors: readonly ClipVector[]): ClipVector | null {
  if (vectors.length === 0) return null;
  const { modelId, values } = vectors[0];
  const dim = values.length;
  if (dim === 0) return null;
  const sum = new Float32Array(dim);
  for (const v of vectors) {
    if (v.modelId !== modelId || v.values.length !== dim) return null;
    for (let i = 0; i < dim; i++) sum[i] += v.values[i];
  }
  return { modelId, values: normalize(sum) };
}

/**
 * Cele mai apropiate `limit` poze de una data. Ordonate descrescator.
 *
 * Candidatii din alt model sunt SARITI, nu tratati ca nepotriviri: o poza
 * analizata cu modelul vechi nu e "diferita", e "necunoscuta" — iar diferenta
 * conteaza in ziua in care biblioteca are amandoua felurile, dupa o schimbare
 * de model.
 */
export function nearest<T extends { vector: ClipVector }>(
  query: ClipVector,
  candidates: readonly T[],
  limit: number,
  minScore = -1
): { item: T; score: number }[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of candidates) {
    const score = cosine(query, item.vector);
    if (score === null || score < minScore) continue;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit));
}
