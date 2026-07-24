/// <reference lib="webworker" />
/**
 * workers/hashCompare.worker.ts
 *
 * Gruparea seriilor/duplicatelor (distanta Hamming intre dHash-uri, 9x8=64
 * biti per poza) era O(n^2) rulat SINCRON pe firul principal, in
 * importPipeline.ts — pentru 1000+ poze, sute de mii/milioane de comparatii
 * de string blocheaza UI-ul vizibil in timpul importurilor mari. Mutat aici,
 * procesat in chunk-uri cu un yield intre fiecare, ca firul principal sa
 * ramana interactiv indiferent cat de mare e biblioteca.
 *
 * Foloseste Comlink (ca restul worker-elor din proiect — faceAnalysis.worker.ts)
 * in loc de postMessage brut, pentru consistenta si tipare sigure: apelantul
 * primeste actualizari incrementale printr-un callback proxy (acelasi tipar
 * ca analyzeBatch/onProgress), nu prin ascultarea manuala a evenimentelor.
 */
import * as Comlink from 'comlink';
import { pickBestInGroup, type GroupCandidate } from '../core/groupSelection';
import { bkInsert, bkQuery, type BKNode } from '../core/bkTree';

/**
 * `score` (aiScore) ramane pastrat pentru compatibilitate/afisare, dar alegerea
 * `bestId` foloseste acum ierarhia de criterii din groupSelection.ts (claritate
 * > expunere > compozitie > expresii faciale > contact vizual) — mai robusta
 * decat scorul AI brut la "cold start" (model neantrenat, scoruri aproape
 * identice intre cadre similare). Restul campurilor GroupCandidate sunt
 * optionale: absente => tratate neutru de pickBestInGroup, exact ca inainte.
 */
export interface HashInput extends Partial<Omit<GroupCandidate, 'id'>> {
  id: string;
  hash: string;
  score: number;
  /** Embedding-uri (1024-dim, FaceRes) ale fetelor detectate in poza — unul per fata, absent/gol daca nu s-a detectat nicio fata. */
  faceEmbeddings?: number[][];
  /** 0..1, vezi AnalysisRecord.colorHarmonyScore — folosit doar ca semnal secundar cand nu exista fete de comparat. */
  colorHarmonyScore?: number;
}

export interface GroupUpdate {
  photoId: string;
  groupId: string;
}

export interface GroupResult {
  groupId: string;
  memberIds: string[];
  /** id-ul cu scorul AI cel mai mare din grup — restul raman candidati de sters/de verificat. */
  bestId: string;
}

const CHUNK_SIZE = 50;
/**
 * Acelasi prag deja calibrat in importPipeline.ts (DHASH_DISTANCE) — pe un
 * dHash de 64 biti, 8 inseamna ~12% diferenta, suficient de strans pentru
 * cadre din aceeasi rafala fara sa grupeze poze vizibil diferite intre ele.
 */
const SIMILARITY_THRESHOLD = 8;

function hammingDistance(a: string, b: string): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++;
  return d;
}

interface Bucket {
  seedHash: string;
  members: HashInput[];
}

/**
 * dHash e un semnal STRUCTURAL (gradient de luminanta pe o grila 9x8) — poze
 * cu compozitie/expunere similara dar SUBIECTI DIFERITI (ex. acelasi unghi de
 * cadru la o nunta, dar grupuri diferite de invitati) pot cadea, din pacate,
 * sub acelasi prag de distanta Hamming ca o rafala reala. Pragul ramane
 * MAI PERMISIV decat cel de la recunoastere/clustering (0.55/0.65 in
 * faceAnalysis.worker.ts / faceClustering.ts): aici comparam cadre deja
 * confirmate ca structural similare de dHash, deci fetele ACELUIASI subiect
 * ar trebui sa semene puternic — un prag mai jos ar rata prea multe potriviri
 * reale (unghi/expresie usor diferite intre cadre consecutive).
 */
const FACE_MATCH_THRESHOLD = 0.5;
/** Delta compozitie/armonie culori peste care doua poze par scene diferite — folosit DOAR cand nu exista fete de comparat. */
const COMPOSITION_DELTA_THRESHOLD = 0.4;
const COLOR_HARMONY_DELTA_THRESHOLD = 0.35;
/** Peste acest numar de membri intr-un bucket, sarim rafinarea O(n^2) — bucket-e dHash normale raman mult sub prag. */
const MAX_REFINEMENT_BUCKET_SIZE = 200;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function bestFaceSimilarity(a: number[][], b: number[][]): number | null {
  if (!a.length || !b.length) return null;
  let best = -1;
  for (const ea of a) for (const eb of b) best = Math.max(best, cosineSimilarity(ea, eb));
  return best;
}

/**
 * Decide daca doua poze DEJA in acelasi bucket dHash par sa arate acelasi
 * subiect/scena. Fetele sunt semnalul decisiv cand exista pe ambele parti;
 * fara fete (peisaje, spate intors), recurge la compozitie+armonie culori —
 * dar cere ca AMBELE sa diverga semnificativ, ca un singur semnal zgomotos
 * sa nu desparta gresit cadre reale din aceeasi serie. Fara niciun semnal
 * utilizabil, ramane compatibila (comportamentul original, doar-dHash).
 */
function looksLikeSameSubject(a: HashInput, b: HashInput): boolean {
  const faceSim = bestFaceSimilarity(a.faceEmbeddings ?? [], b.faceEmbeddings ?? []);
  if (faceSim !== null) return faceSim >= FACE_MATCH_THRESHOLD;

  if (a.compositionScore != null && b.compositionScore != null && a.colorHarmonyScore != null && b.colorHarmonyScore != null) {
    const compositionDelta = Math.abs(a.compositionScore - b.compositionScore);
    const colorDelta = Math.abs(a.colorHarmonyScore - b.colorHarmonyScore);
    return !(compositionDelta > COMPOSITION_DELTA_THRESHOLD && colorDelta > COLOR_HARMONY_DELTA_THRESHOLD);
  }
  return true;
}

/**
 * Imparte un bucket dHash in componente conexe dupa `looksLikeSameSubject`
 * (Union-Find) si pastreaza doar cea mai mare drept grup real — restul
 * membrilor (probabil un fals-pozitiv de dHash) raman NEGRUPATI, la fel ca
 * orice poza fara nicio alta similara. Nu incearca sa-i realipeasca intr-un
 * grup nou separat: scopul e sa REDUCA fals-pozitivele, nu o reclusterizare
 * completa.
 */
function refineBucket(members: HashInput[]): HashInput[] {
  if (members.length < 2 || members.length > MAX_REFINEMENT_BUCKET_SIZE) return members;

  const parent = members.map((_, i) => i);
  function find(i: number): number { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i: number, j: number) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (looksLikeSameSubject(members[i], members[j])) union(i, j);
    }
  }

  const componentsByRoot = new Map<number, HashInput[]>();
  members.forEach((m, i) => {
    const root = find(i);
    const list = componentsByRoot.get(root);
    if (list) list.push(m); else componentsByRoot.set(root, [m]);
  });

  if (componentsByRoot.size <= 1) return members; // niciun mismatch gasit — comportament neschimbat

  let largest: HashInput[] = [];
  for (const component of componentsByRoot.values()) {
    if (component.length > largest.length) largest = component;
  }
  return largest;
}

export class HashCompareService {
  /**
   * Grupeaza pozele dupa similaritatea dHash (clustering greedy cu "seed" —
   * fiecare grup e reprezentat de PRIMA poza care l-a creat, exact ca in
   * algoritmul original din importPipeline.ts, pastrat identic ca sa nu
   * schimbe comportamentul vizibil, doar mecanismul de executie).
   *
   * O poza fara nicio alta similara ramane NEGRUPATA (nu primeste groupId) —
   * la fel ca inainte: "Serie/duplicat" trebuie sa insemne cu-adevarat 2+
   * cadre similare, nu orice poza izolata.
   */
  async groupPhotos(
    photos: HashInput[],
    onUpdate?: (update: GroupUpdate) => void
  ): Promise<{ groups: GroupResult[]; totalGroups: number }> {
    const buckets: Bucket[] = [];
    // indexeaza seed-ul fiecarui bucket (BK-tree, distanta Hamming) — plan 2.3.3
    // ("algoritmi optimizati... LSH"): media O(n) in loc de O(n * buckets) la
    // biblioteci mari cu multe serii distincte, dar EXACT (nu aproximativ ca LSH
    // clasic), asa ca rezultatul de grupare ramane identic cu varianta liniara.
    let seedTree: BKNode<number> | null = null; // valoare = indexul bucket-ului in `buckets`

    for (let start = 0; start < photos.length; start += CHUNK_SIZE) {
      const chunk = photos.slice(start, start + CHUNK_SIZE);
      for (const photo of chunk) {
        const candidates = bkQuery(seedTree, photo.hash, SIMILARITY_THRESHOLD, hammingDistance);
        // primul bucket creat dintre candidati — aceeasi regula de departajare ca
        // Array.prototype.find de dinainte (scanare in ordinea crearii)
        const bucketIndex = candidates.length ? Math.min(...candidates) : -1;
        if (bucketIndex !== -1) {
          buckets[bucketIndex].members.push(photo);
        } else {
          const newIndex = buckets.length;
          buckets.push({ seedHash: photo.hash, members: [photo] });
          seedTree = bkInsert(seedTree, photo.hash, newIndex, hammingDistance);
        }
      }
      // elibereaza firul (al worker-ului) intre chunk-uri — pe un fir dedicat
      // asta nu conteaza pentru main thread-ul aplicatiei (deja neblocat prin
      // simplul fapt ca ruleaza intr-un Worker), dar pastreaza worker-ul
      // insusi receptiv la alte mesaje intre loturi, exact cum a cerut specificatia.
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const groups: GroupResult[] = [];
    for (const bucket of buckets) {
      const members = refineBucket(bucket.members);
      if (members.length < 2) continue; // fara grup pentru poze unice (inclusiv dupa rafinare)
      const groupId = 'g-' + members[0].id.slice(0, 8);
      const bestId = pickBestInGroup(members.map(m => ({
        id: m.id,
        sharpness: m.sharpness ?? 0,
        exposure: m.exposure ?? 50,
        compositionScore: m.compositionScore,
        faceCount: m.faceCount ?? 0,
        bestSmile: m.bestSmile ?? 0,
        groupSmileRatio: m.groupSmileRatio,
        allEyesOpen: m.allEyesOpen ?? true,
        groupEyesOpenRatio: m.groupEyesOpenRatio,
        avgEyeContact: m.avgEyeContact
      })));
      for (const m of members) onUpdate?.({ photoId: m.id, groupId });
      groups.push({ groupId, memberIds: members.map(m => m.id), bestId });
    }

    return { groups, totalGroups: groups.length };
  }
}

export type HashCompareAPI = HashCompareService;

Comlink.expose(new HashCompareService());
