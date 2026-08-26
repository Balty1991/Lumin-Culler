/**
 * core/similarPhotos.ts
 *
 * "Arata-mi altele ca asta" — pozele din biblioteca inrudite ca CONTINUT cu
 * una anume, oricand ar fi fost facute.
 *
 * De ce se poate face acum, ieftin: pe Android, fiecare poza primeste la
 * import un `imageEmbedding` (MediaPipe Image Embedder + MobileNetV3-small,
 * vezi core/nativeImageEmbedder.ts). Se calculeaza oricum, se salveaza oricum,
 * si pana acum era citit intr-un singur loc — hashCompare.worker.ts, ca a doua
 * opinie la gruparea seriilor. Aceeasi valoare raspunde gratis la o intrebare
 * pe care aplicatia n-o punea deloc.
 *
 * CE NU E: nu e cautare in cuvinte. MobileNetV3 e un model cu un singur turn —
 * intelege imagini, nu text. Nu exista nicio cale de a codifica "fetita cu
 * bicicleta rosie" in acelasi spatiu; aia ar cere un model cu doua turnuri
 * (MobileCLIP, SigLIP), model nou in APK si reanalizarea intregii biblioteci.
 *
 * NU E NICI "serie/duplicat": seriile se fac pe dHash plus timp, si raspund la
 * "sunt acelasi cadru?". Asta raspunde la "seamana?" — aceeasi plaja la un an
 * distanta, acelasi fel de poza, nu acelasi declic.
 */

/** Cate rezultate intoarcem cel mult. Peste atat, "asemanator" isi pierde intelesul si grila devine iar toata biblioteca. */
export const SIMILAR_LIMIT = 40;

/**
 * Sub pragul asta doua poze n-au nimic de-a face una cu alta.
 *
 * Mai jos decat pragul de 0,75 folosit la rafinarea seriilor (vezi
 * IMAGE_EMBEDDING_MATCH_THRESHOLD in hashCompare.worker.ts), si dinadins:
 * acolo intrebarea e "acelasi cadru?", aici e "seamana?". Un prag de serie
 * aplicat aici ar intoarce aproape numai poze pe care utilizatorul le vede
 * oricum grupate, adica exact ce stie deja.
 */
export const SIMILAR_THRESHOLD = 0.55;

export interface EmbeddedPhoto {
  photoId: string;
  imageEmbedding?: number[];
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Pozele asemanatoare cu `sourceId`, cele mai apropiate intai.
 *
 * Sursa insasi NU e in rezultat: cine apasa "arata-mi altele ca asta" stie
 * deja de poza din care a plecat. Cheamatorul o pune inapoi in fata daca vrea.
 *
 * Intoarce lista goala cand sursa n-are embedding (web, sau inregistrari de
 * dinainte de plugin) — caz in care apelantul trebuie sa spuna de ce, nu sa
 * arate o grila goala.
 */
export function findSimilarPhotos(rows: EmbeddedPhoto[], sourceId: string): string[] {
  const source = rows.find(r => r.photoId === sourceId);
  if (!source?.imageEmbedding?.length) return [];

  const sourceEmbedding = source.imageEmbedding;
  const sourceNorm = norm(sourceEmbedding);
  if (sourceNorm === 0) return [];

  const scored: { id: string; score: number }[] = [];
  for (const row of rows) {
    if (row.photoId === sourceId) continue;
    const other = row.imageEmbedding;
    if (!other?.length) continue;
    const otherNorm = norm(other);
    if (otherNorm === 0) continue;
    const score = dot(sourceEmbedding, other) / (sourceNorm * otherNorm);
    if (score >= SIMILAR_THRESHOLD) scored.push({ id: row.photoId, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SIMILAR_LIMIT).map(s => s.id);
}
