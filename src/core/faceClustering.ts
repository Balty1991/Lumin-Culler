/**
 * core/faceClustering.ts
 * "Sugestii AI pentru gruparea fetelor similare" (plan 3.2.3, PersonsPanel) —
 * grupeaza fetele NErecunoscute (personId null) din toata biblioteca dupa
 * similaritatea cosinus a embedding-ului lor (acelasi FaceRes descriptor
 * 1024-dim folosit la recunoastere, vezi faceAnalysis.worker.ts), ca sa
 * sugereze: "aceasta fata neidentificata apare de N ori — vrei sa o inrolezi?".
 *
 * Clustering greedy pe "seed" (prima fata care a creat grupul), acelasi tipar
 * ca gruparea dupa dHash din hashCompare.worker.ts — O(n * clustere) in loc de
 * O(n^2), suficient de rapid pentru rulare pe cerere (buton explicit in UI,
 * nu automat la fiecare deschidere a panoului).
 *
 * Prag MAI STRICT decat cel de recunoastere (0.55): o sugestie automata,
 * neverificata de om, trebuie sa fie mai conservatoare — un fals grup ar
 * amesteca doua persoane diferite sub acelasi profil nou.
 */
const CLUSTER_SIMILARITY_THRESHOLD = 0.65;

export interface FaceClusterMember {
  photoId: string;
  fileName: string;
  faceIndex: number;
  box: [number, number, number, number];
  embedding: number[];
}

export interface FaceCluster {
  members: FaceClusterMember[];
}

export interface ClusterablePhoto {
  id: string;
  fileName: string;
  faces: { personId: string | null; embedding?: number[]; box: [number, number, number, number] }[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Aceeasi similaritate, dar cu normele PRECALCULATE — vezi bucla din
 * findUnrecognizedFaceClusters pentru de ce conteaza.
 *
 * Masurat de auditul QA (embeddinguri distincte, 1024 dimensiuni, deci cazul
 * cel mai rau in care fiecare fata isi deschide propriul cluster): 4000 de
 * fete durau ~2,4s pe desktop — pe un telefon de gama medie inseamna zeci de
 * secunde cu FIRUL PRINCIPAL BLOCAT, fiindca functia e apelata direct din
 * PersonsPanel, nu dintr-un worker. Costul e intrinsec patratic (fiecare fata
 * se compara cu fiecare cluster existent), dar varianta veche recalcula, la
 * FIECARE comparatie, si norma seed-ului si norma item-ului — desi ambele sunt
 * constante. Adica doua treimi din inmultiri erau munca refacuta degeaba.
 *
 * Rezultatele raman IDENTICE bit-cu-bit: `dot` se aduna in exact aceeasi
 * ordine, iar normele sunt aceleasi sume, doar calculate o singura data. Cand
 * lungimile difera (embeddinguri din modele diferite, unde functia veche
 * trunchia la cea mai scurta si deci normele partiale NU coincid cu cele
 * complete), cadem inapoi pe implementarea originala, ca sa nu schimbam
 * nicicum comportamentul.
 */
function cosineWithNorms(a: number[], normA: number, b: number[], normB: number): number {
  if (a.length !== b.length) return cosineSimilarity(a, b);
  const denom = normA * normB;
  if (denom <= 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / denom;
}

function norm(v: number[]): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  return Math.sqrt(n);
}

export function findUnrecognizedFaceClusters(photos: ClusterablePhoto[], minClusterSize = 2): FaceCluster[] {
  const items: FaceClusterMember[] = [];
  for (const p of photos) {
    p.faces.forEach((f, faceIndex) => {
      if (!f.personId && f.embedding && f.embedding.length) {
        items.push({ photoId: p.id, fileName: p.fileName, faceIndex, box: f.box, embedding: f.embedding });
      }
    });
  }

  const clusters: { seed: number[]; seedNorm: number; members: FaceClusterMember[] }[] = [];
  for (const item of items) {
    const itemNorm = norm(item.embedding); // o data per fata, nu o data per comparatie
    const bucket = clusters.find(c => cosineWithNorms(c.seed, c.seedNorm, item.embedding, itemNorm) >= CLUSTER_SIMILARITY_THRESHOLD);
    if (bucket) bucket.members.push(item);
    else clusters.push({ seed: item.embedding, seedNorm: itemNorm, members: [item] });
  }

  return clusters
    .filter(c => c.members.length >= minClusterSize)
    .sort((a, b) => b.members.length - a.members.length)
    .map(c => ({ members: c.members }));
}
