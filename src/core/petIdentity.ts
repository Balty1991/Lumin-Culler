/**
 * core/petIdentity.ts
 * Același animal, nu doar „e un câine”.
 *
 * Decupajul vine din ML Kit Object Detection când există o cutie, altfel din
 * centrul cadrului. Embeddingul e MobileNetV3-small (MediaPipe Image Embedder,
 * `assets/mobilenet_v3_small.tflite`, Apache 2.0), deja în APK. E un embedding
 * de SCENĂ antrenat pe ImageNet, nu o biometrică de animal.
 *
 * Pragul e 0,93: doar decupajele foarte apropiate se unesc. Nu separă doi
 * câini asemănători. Măsurat pe fișierul tflite (intrare 224, pixeli/255),
 * pe desene, nu pe poze reale:
 * - același desen, puțin mai luminos: cosinus 0,95 (se unește);
 * - doi câini asemănători, aceeași canapea: 0,96 (se unesc și ei);
 * - același desen, altă cameră: 0,82 (se despart);
 * - câine și pisică: 0,60 (se despart).
 * Un prag mai mare i-ar despărți și pe cei doi câini, și același animal la
 * altă lumină: scorurile stau lipite. Un decupaj greșit (omul, sau centrul
 * unui peisaj) înglobează fundalul.
 */
export const PET_CLUSTER_SIMILARITY = 0.93;

/** Când detectorul nu dă nicio cutie, decupajul e centrul cadrului, nu toată poza. */
export const PET_CENTER_CROP = { x: 0.15, y: 0.12, w: 0.7, h: 0.7 };

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ObjectBox extends NormRect {
  label?: string;
}

/** Etichete de animal ale modelului de bază ML Kit Image Labeling (engleză, offline). */
const ANIMAL_LABELS = new Set([
  'dog', 'cat', 'bird', 'horse', 'animal', 'pet', 'puppy', 'kitten',
  'fish', 'rabbit', 'cow', 'sheep', 'elephant', 'bear', 'zebra', 'giraffe',
  'lion', 'tiger', 'monkey', 'deer', 'fox', 'wolf', 'hamster', 'turtle',
  'duck', 'chicken', 'goat', 'pig', 'wildlife', 'mammal', 'reptile',
  'insect', 'butterfly', 'bee', 'spider', 'snake', 'frog', 'lizard',
  'parrot', 'eagle', 'owl', 'penguin', 'dolphin', 'whale', 'shark',
  'cattle', 'livestock', 'feline', 'canine', 'squirrel', 'mouse', 'rat',
  'hedgehog', 'camel', 'kangaroo'
]);

export function isAnimalTag(tag: string): boolean {
  return ANIMAL_LABELS.has(tag.trim().toLowerCase());
}

/** Prima etichetă de animal, în ordinea primită (modelul le dă deja după încredere). */
export function primaryAnimalLabel(tags: readonly string[] | undefined): string | undefined {
  for (const tag of tags ?? []) {
    const key = tag.trim().toLowerCase();
    if (ANIMAL_LABELS.has(key)) return key;
  }
  return undefined;
}

function area(box: NormRect): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function padBox(box: NormRect): NormRect {
  const mx = box.w * 0.08;
  const my = box.h * 0.08;
  const x = Math.min(0.95, Math.max(0, box.x - mx));
  const y = Math.min(0.95, Math.max(0, box.y - my));
  const right = Math.min(1, Math.max(x + 0.05, box.x + box.w + mx));
  const bottom = Math.min(1, Math.max(y + 0.05, box.y + box.h + my));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Cutia animalului. Dacă detectorul a clasificat o cutie ca animal, o preferăm
 * pe cea mai mare dintre ele. Altfel, cutia cea mai mare (subiectul salient),
 * iar fără nicio cutie — centrul cadrului.
 */
export function choosePetCrop(boxes: readonly ObjectBox[]): NormRect {
  const usable = boxes.filter(b => b.w > 0 && b.h > 0);
  const animals = usable.filter(b => b.label && isAnimalTag(b.label));
  const pool = animals.length ? animals : usable;
  if (!pool.length) return { ...PET_CENTER_CROP };
  const best = pool.reduce((a, b) => (area(a) >= area(b) ? a : b));
  return padBox(best);
}

export interface PetClusterPhoto {
  id: string;
  petName?: string | null;
  petLabel?: string;
  petEmbedding?: number[];
}

export interface PetClusterMember {
  photoId: string;
  embedding: number[];
}

export interface PetCluster {
  label: string;
  members: PetClusterMember[];
}

function cosine(a: number[], normA: number, b: number[], normB: number): number {
  if (a.length !== b.length) {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
  }
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

/**
 * Grupuri de același animal încă nenumit. Nu amestecă speciile: un câine și o
 * pisică nu ajung în același grup chiar dacă embeddingurile seamănă.
 */
export function findUnnamedPetClusters(photos: readonly PetClusterPhoto[], minClusterSize = 1): PetCluster[] {
  const items: { photoId: string; label: string; embedding: number[] }[] = [];
  for (const photo of photos) {
    if (photo.petName) continue;
    if (!photo.petLabel || !photo.petEmbedding?.length) continue;
    items.push({
      photoId: photo.id,
      label: photo.petLabel.trim().toLowerCase(),
      embedding: photo.petEmbedding
    });
  }
  const clusters: { label: string; seed: number[]; seedNorm: number; members: PetClusterMember[] }[] = [];
  for (const item of items) {
    const itemNorm = norm(item.embedding);
    const bucket = clusters.find(c =>
      c.label === item.label && cosine(c.seed, c.seedNorm, item.embedding, itemNorm) >= PET_CLUSTER_SIMILARITY
    );
    const member = { photoId: item.photoId, embedding: item.embedding };
    if (bucket) bucket.members.push(member);
    else clusters.push({ label: item.label, seed: item.embedding, seedNorm: itemNorm, members: [member] });
  }
  return clusters
    .filter(c => c.members.length >= minClusterSize)
    .sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label))
    .map(c => ({ label: c.label, members: c.members }));
}

export function matchNamedPet(
  embedding: number[],
  named: readonly { name: string; embedding: number[] }[],
  threshold = PET_CLUSTER_SIMILARITY
): string | null {
  let bestName: string | null = null;
  let best = 0;
  const n = norm(embedding);
  for (const pet of named) {
    if (pet.embedding.length !== embedding.length && pet.embedding.length === 0) continue;
    const sim = cosine(embedding, n, pet.embedding, norm(pet.embedding));
    if (sim > best) { best = sim; bestName = pet.name; }
  }
  return best >= threshold ? bestName : null;
}
