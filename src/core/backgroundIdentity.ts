/**
 * core/backgroundIdentity.ts
 * Fețe (faceres, doar APK-ul de test) și animale (MobileNet pe decupaj),
 * DUPĂ ce primul rezultat e deja pe ecran. Nu e apelat din treapta 1 și nu
 * intră în `analyze()`.
 */
import type { AnalysisRecord, FaceInsight } from './db';
import {
  choosePetCrop, matchNamedPet, primaryAnimalLabel,
  type NormRect, type ObjectBox
} from './petIdentity';

const FACE_CROP_MARGIN = 0.4;
/** La 480 px un prag de 60 ar arunca fețe care la rezoluție plină sunt utilizabile. */
const MIN_FACE_CROP_PX = 48;
const MAX_FACES_WHEN_NAMED = 6;
const MAX_FACES_FOR_GROUPING = 2;
/** Același prag ca NATIVE_RECOGNITION_THRESHOLD din nativeAnalysis.ts. */
const FACE_MATCH_THRESHOLD = 0.55;

export interface MeshFaceBox {
  boundingBox?: { left: number; top: number; width: number; height: number };
  eyesOpen: { left: number; right: number };
  smile?: number;
}

export interface EnrichInput {
  analysis: AnalysisRecord;
  file: File;
  mediaUri?: string;
  aside?: 'document' | 'screenshot';
}

export interface KnownFaceRef {
  id: string;
  name: string;
  embeddings: number[][];
}

export interface EnrichDeps {
  testIdentity: boolean;
  blinkThreshold: number;
  mesh?: (uri: string) => Promise<{ faces: MeshFaceBox[]; imageWidth?: number; imageHeight?: number }>;
  decodeSmall?: (file: File) => Promise<ImageBitmap>;
  cropFace?: (bitmap: ImageBitmap, box: [number, number, number, number]) => Promise<ImageBitmap | null>;
  embedFace?: (crop: ImageBitmap) => Promise<{ embedding: number[] } | null>;
  knownPersons?: KnownFaceRef[];
  label?: (uri: string) => Promise<string[]>;
  detectObjects?: (uri: string) => Promise<ObjectBox[]>;
  embedCrop?: (uri: string, crop: NormRect) => Promise<number[] | null>;
  namedPets?: { name: string; embedding: number[] }[];
}

export interface EnrichResult {
  changed: boolean;
  eyesClosed: boolean;
  measuredFaces: number;
  namedPet?: { name: string; embedding: number[] };
}

export async function cropFaceBitmap(
  bitmap: ImageBitmap,
  box: [number, number, number, number]
): Promise<ImageBitmap | null> {
  const [nx, ny, nw, nh] = box;
  if (!(nw > 0) || !(nh > 0)) return null;
  const x0 = Math.max(0, nx - nw * FACE_CROP_MARGIN);
  const y0 = Math.max(0, ny - nh * FACE_CROP_MARGIN);
  const x1 = Math.min(1, nx + nw + nw * FACE_CROP_MARGIN);
  const y1 = Math.min(1, ny + nh + nh * FACE_CROP_MARGIN);
  const left = Math.round(x0 * bitmap.width);
  const top = Math.round(y0 * bitmap.height);
  const width = Math.max(0, Math.round(x1 * bitmap.width) - left);
  const height = Math.max(0, Math.round(y1 * bitmap.height) - top);
  if (width < MIN_FACE_CROP_PX || height < MIN_FACE_CROP_PX) return null;
  return createImageBitmap(bitmap, left, top, width, height);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function matchPerson(embedding: number[], persons: readonly KnownFaceRef[]): { id: string; name: string; similarity: number } | null {
  let best: { id: string; name: string; similarity: number } | null = null;
  for (const person of persons) {
    for (const ref of person.embeddings) {
      const similarity = cosine(embedding, ref);
      if (!best || similarity > best.similarity) best = { id: person.id, name: person.name, similarity };
    }
  }
  return best && best.similarity >= FACE_MATCH_THRESHOLD ? best : null;
}

function insightsFromMesh(faces: MeshFaceBox[], width: number, height: number, blinkThreshold: number): FaceInsight[] {
  if (!(width > 0) || !(height > 0)) return [];
  const out: FaceInsight[] = [];
  for (const face of faces) {
    const box = face.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const left = face.eyesOpen.left;
    const right = face.eyesOpen.right;
    out.push({
      box: [box.left / width, box.top / height, box.width / width, box.height / height],
      faceScore: 1,
      smile: face.smile ?? 0,
      eyesOpen: { left, right },
      isBlinking: left < blinkThreshold || right < blinkThreshold,
      personId: null,
      personName: null,
      similarity: 0
    });
  }
  return out;
}

function recount(analysis: AnalysisRecord): void {
  analysis.faceCount = analysis.faces.length;
  analysis.knownFaceCount = analysis.faces.filter(f => f.personId).length;
  analysis.strangerCount = analysis.faces.filter(f => !f.personId).length;
  analysis.bestSmile = analysis.faces.reduce((m, f) => Math.max(m, f.smile), 0);
  analysis.allEyesOpen = analysis.faces.every(f => !f.isBlinking);
}

export async function enrichAfterFirstResult(input: EnrichInput, deps: EnrichDeps): Promise<EnrichResult> {
  const { analysis } = input;
  if (input.aside) return { changed: false, eyesClosed: false, measuredFaces: analysis.faceCount };
  let changed = false;
  let eyesClosed = false;
  let measuredFaces = analysis.faces.length;

  if (deps.mesh && input.mediaUri && analysis.faces.length === 0) {
    try {
      const mesh = await deps.mesh(input.mediaUri);
      measuredFaces = mesh.faces.length;
      eyesClosed = mesh.faces.some(f => f.eyesOpen.left < deps.blinkThreshold || f.eyesOpen.right < deps.blinkThreshold);
      if (deps.testIdentity && mesh.faces.length) {
        const faces = insightsFromMesh(mesh.faces, mesh.imageWidth ?? 0, mesh.imageHeight ?? 0, deps.blinkThreshold);
        if (faces.length) {
          analysis.faces = faces;
          recount(analysis);
          changed = true;
          measuredFaces = faces.length;
          eyesClosed = faces.some(f => f.isBlinking);
        }
      }
    } catch {
      // ochii nemăsurați nu schimbă verdictul
    }
  }

  if (deps.testIdentity && deps.decodeSmall && deps.cropFace && deps.embedFace && analysis.faces.some(f => !f.embedding?.length)) {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await deps.decodeSmall(input.file);
      const cap = (deps.knownPersons?.length ?? 0) > 0 ? MAX_FACES_WHEN_NAMED : MAX_FACES_FOR_GROUPING;
      const order = analysis.faces
        .map((face, index) => ({ index, area: face.box[2] * face.box[3], has: !!face.embedding?.length }))
        .filter(row => !row.has)
        .sort((a, b) => b.area - a.area)
        .slice(0, cap);
      for (const row of order) {
        const face = analysis.faces[row.index];
        const crop = await deps.cropFace(bitmap, face.box);
        if (!crop) continue;
        try {
          const embedded = await deps.embedFace(crop);
          if (!embedded?.embedding.length) continue;
          face.embedding = embedded.embedding;
          const hit = matchPerson(embedded.embedding, deps.knownPersons ?? []);
          if (hit) {
            face.personId = hit.id;
            face.personName = hit.name;
            face.similarity = Math.round(hit.similarity * 100) / 100;
          }
          changed = true;
        } finally {
          try { crop.close(); } catch { /* deja închis */ }
        }
      }
      if (changed) recount(analysis);
    } catch {
      // fără embedding, fața rămâne de numit manual, poza rămâne cum a ieșit din treapta 1
    } finally {
      try { bitmap?.close(); } catch { /* deja închis */ }
    }
  }

  if (deps.embedCrop && input.mediaUri && !analysis.petEmbedding?.length) {
    try {
      let tags = analysis.sceneTags ?? [];
      if (!tags.length && deps.label) {
        tags = await deps.label(input.mediaUri);
        if (tags.length) {
          analysis.sceneTags = tags;
          changed = true;
        }
      }
      const animal = primaryAnimalLabel(tags);
      if (animal) {
        const boxes = deps.detectObjects ? await deps.detectObjects(input.mediaUri) : [];
        const crop = choosePetCrop(boxes);
        const embedding = await deps.embedCrop(input.mediaUri, crop);
        if (embedding?.length) {
          analysis.petLabel = animal;
          analysis.petEmbedding = embedding;
          const name = matchNamedPet(embedding, deps.namedPets ?? []);
          if (name) analysis.petName = name;
          changed = true;
          if (name) return { changed, eyesClosed, measuredFaces, namedPet: { name, embedding } };
        }
      }
    } catch {
      // animalul rămâne, cel mult, o etichetă de specie
    }
  }

  return { changed, eyesClosed, measuredFaces };
}
