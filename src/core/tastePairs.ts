/**
 * core/tastePairs.ts
 * Perechile pentru „Învață-mă”: întrebările din care AI-ul află ce păstrezi tu.
 *
 * Pozele vin din galeria omului, nu dintr-un set inclus: gustul se învață pe
 * tipul lui de poze (copilul, curtea, selfie-urile), fără drepturi de autor pe
 * poze străine și fără MB în plus în aplicație.
 *
 * Trei feluri de întrebări, fiecare cu altă lecție:
 * - „serie”: două cadre din aceeași rafală, cu scoruri apropiate — ce
 *   contează când aproape totul e la fel (zâmbet, privire, încadrare);
 * - „calitate”: același fel de poză (cu oameni / fără), una clară și una
 *   mișcată sau întunecată — cât de mult îl deranjează defectele;
 * - „subiect”: o poză cu oameni și una fără, de calitate apropiată — ce
 *   păstrează când trebuie să aleagă.
 * Nicio poză nu apare de două ori. Documentele și capturile nu intră.
 *
 * Fără dependințe de DB sau UI: primește pozele, întoarce perechi.
 */

export interface TasteCandidate {
  id: string;
  aiScore: number;
  sharpness: number;
  exposure: number;
  faceCount: number;
  groupId?: string;
  aside?: string;
}

export type TastePairKind = 'series' | 'quality' | 'subject';

export interface TastePair {
  kind: TastePairKind;
  aId: string;
  bId: string;
}

/**
 * Câte întrebări: 15–20 ajung ca să regleze trăsăturile simple ale modelului
 * (claritate, ochi, zâmbet, expunere), ~2 minute. Omul poate apăsa „Gata”
 * după TASTE_QUIZ_MIN_ANSWERS.
 */
export const TASTE_QUIZ_SIZE = 16;
/** De aici încolo testul se poate încheia oricând („Gata”). */
export const TASTE_QUIZ_MIN_ANSWERS = 8;
/** Sub atâtea poze utilizabile, testul n-are din ce alege. */
export const TASTE_QUIZ_MIN_PHOTOS = 8;

const MAX_SERIES = 7;
const MAX_QUALITY = 5;
const MAX_SUBJECT = 4;
/** Diferență de claritate/expunere care se vede cu ochiul liber. */
const VISIBLE_DEFECT = 18;
/** Două poze cu scoruri la atât una de alta sunt „de calitate apropiată”. */
const SIMILAR_SCORE = 12;

function defect(p: TasteCandidate): number {
  return Math.max(0, 60 - p.sharpness) + Math.max(0, Math.abs(p.exposure - 50) - 10);
}

/** Amestecare stabilă după id: aceeași bibliotecă dă aceleași întrebări. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildTastePairs(photos: readonly TasteCandidate[], size = TASTE_QUIZ_SIZE): TastePair[] {
  const usable = photos.filter(p => !p.aside && Number.isFinite(p.sharpness) && Number.isFinite(p.exposure));
  if (usable.length < TASTE_QUIZ_MIN_PHOTOS) return [];
  const used = new Set<string>();
  const take = (kind: TastePairKind, a: TasteCandidate, b: TasteCandidate, out: TastePair[]) => {
    used.add(a.id);
    used.add(b.id);
    // Ordinea pe ecran nu trebuie să trădeze care e „mai bună” după AI.
    out.push(hash(a.id + b.id) % 2 ? { kind, aId: a.id, bId: b.id } : { kind, aId: b.id, bId: a.id });
  };

  // 1. Serii: cele mai strânse două cadre din fiecare grup, grupurile cele mai mari primele.
  const series: TastePair[] = [];
  const groups = new Map<string, TasteCandidate[]>();
  for (const p of usable) {
    if (!p.groupId) continue;
    const list = groups.get(p.groupId) ?? [];
    list.push(p);
    groups.set(p.groupId, list);
  }
  const ordered = [...groups.values()].filter(g => g.length >= 2).sort((x, y) => y.length - x.length);
  for (const g of ordered) {
    if (series.length >= MAX_SERIES) break;
    const byScore = [...g].sort((x, y) => y.aiScore - x.aiScore);
    let best: [TasteCandidate, TasteCandidate] | null = null;
    for (let i = 0; i + 1 < byScore.length; i++) {
      const gap = byScore[i].aiScore - byScore[i + 1].aiScore;
      if (!best || gap < best[0].aiScore - best[1].aiScore) best = [byScore[i], byScore[i + 1]];
    }
    if (best) take('series', best[0], best[1], series);
  }

  // 2. Calitate: aceeași categorie (cu oameni / fără), una curată și una cu defect vizibil.
  const quality: TastePair[] = [];
  const free = () => usable.filter(p => !used.has(p.id));
  for (const withPeople of [true, false, true, false]) {
    if (quality.length >= MAX_QUALITY) break;
    const pool = free().filter(p => (p.faceCount > 0) === withPeople);
    if (pool.length < 2) continue;
    const clean = [...pool].sort((x, y) => defect(x) - defect(y))[0];
    const flawed = [...pool].sort((x, y) => defect(y) - defect(x))[0];
    if (clean.id !== flawed.id && defect(flawed) - defect(clean) >= VISIBLE_DEFECT) take('quality', clean, flawed, quality);
  }

  // 3. Subiect: oameni contra fără oameni, la calitate apropiată.
  const subject: TastePair[] = [];
  for (let k = 0; k < MAX_SUBJECT; k++) {
    const people = free().filter(p => p.faceCount > 0).sort((x, y) => hash(x.id) - hash(y.id));
    const others = free().filter(p => p.faceCount === 0);
    let made = false;
    for (const person of people) {
      const match = others
        .filter(o => Math.abs(o.aiScore - person.aiScore) <= SIMILAR_SCORE)
        .sort((x, y) => Math.abs(x.aiScore - person.aiScore) - Math.abs(y.aiScore - person.aiScore))[0];
      if (match) { take('subject', person, match, subject); made = true; break; }
    }
    if (!made) break;
  }

  // Restul, până la mărime: perechi la întâmplare (stabil), din ce n-a fost folosit.
  const pairs = [...series, ...quality, ...subject];
  const rest = free().sort((x, y) => hash(x.id) - hash(y.id));
  for (let i = 0; i + 1 < rest.length && pairs.length < size; i += 2) take('quality', rest[i], rest[i + 1], pairs);

  // Întrebările se amestecă, ca să nu vină cinci serii la rând.
  return pairs.slice(0, size).sort((x, y) => hash(x.aId) - hash(y.aId));
}

export type TasteAnswer = 'a' | 'b' | 'both' | 'none';
