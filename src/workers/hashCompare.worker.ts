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

    for (let start = 0; start < photos.length; start += CHUNK_SIZE) {
      const chunk = photos.slice(start, start + CHUNK_SIZE);
      for (const photo of chunk) {
        const bucket = buckets.find(b => hammingDistance(photo.hash, b.seedHash) <= SIMILARITY_THRESHOLD);
        if (bucket) bucket.members.push(photo);
        else buckets.push({ seedHash: photo.hash, members: [photo] });
      }
      // elibereaza firul (al worker-ului) intre chunk-uri — pe un fir dedicat
      // asta nu conteaza pentru main thread-ul aplicatiei (deja neblocat prin
      // simplul fapt ca ruleaza intr-un Worker), dar pastreaza worker-ul
      // insusi receptiv la alte mesaje intre loturi, exact cum a cerut specificatia.
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const groups: GroupResult[] = [];
    for (const bucket of buckets) {
      if (bucket.members.length < 2) continue; // fara grup pentru poze unice
      const groupId = 'g-' + bucket.members[0].id.slice(0, 8);
      const bestId = pickBestInGroup(bucket.members.map(m => ({
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
      for (const m of bucket.members) onUpdate?.({ photoId: m.id, groupId });
      groups.push({ groupId, memberIds: bucket.members.map(m => m.id), bestId });
    }

    return { groups, totalGroups: groups.length };
  }
}

export type HashCompareAPI = HashCompareService;

Comlink.expose(new HashCompareService());
