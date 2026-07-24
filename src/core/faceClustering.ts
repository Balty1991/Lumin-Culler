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

export function findUnrecognizedFaceClusters(photos: ClusterablePhoto[], minClusterSize = 2): FaceCluster[] {
  const items: FaceClusterMember[] = [];
  for (const p of photos) {
    p.faces.forEach((f, faceIndex) => {
      if (!f.personId && f.embedding && f.embedding.length) {
        items.push({ photoId: p.id, fileName: p.fileName, faceIndex, box: f.box, embedding: f.embedding });
      }
    });
  }

  const clusters: { seed: number[]; members: FaceClusterMember[] }[] = [];
  for (const item of items) {
    const bucket = clusters.find(c => cosineSimilarity(c.seed, item.embedding) >= CLUSTER_SIMILARITY_THRESHOLD);
    if (bucket) bucket.members.push(item);
    else clusters.push({ seed: item.embedding, members: [item] });
  }

  return clusters
    .filter(c => c.members.length >= minClusterSize)
    .sort((a, b) => b.members.length - a.members.length)
    .map(c => ({ members: c.members }));
}
