/**
 * lumin/textSearch.ts
 * Căutarea în cuvinte: „pisică pe pat”, „Ana”, „bon”, „octombrie”. Fără model
 * nou: caută în ce știe deja AI-ul despre fiecare poză — etichetele de scenă
 * (în română și engleză), descrierea făcută pe telefon, textul citit din poză,
 * oamenii și animalele numite, luna și ziua. Fără diacritice, fără majuscule.
 */
import { translateSceneTag } from '../core/sceneTagLabels';

export interface SearchablePhoto {
  id: string;
  fileName: string;
  capturedAt?: number;
  importedAt: number;
  sceneTags?: string[];
  aiDescription?: string;
  ocrText?: string;
  personNames: string[];
  petNames?: string[];
  aside?: string;
  faceCount: number;
}

/** Cuvinte pe care oamenii le caută, legate de etichetele modelului. */
const SYNONYMS: Record<string, string[]> = {
  copil: ['child', 'baby', 'person', 'persoana', 'copil', 'kid', 'toddler'],
  copii: ['child', 'baby', 'person', 'kid'],
  bebe: ['baby', 'child', 'infant'],
  oameni: ['person', 'people', 'persoana'],
  selfie: ['selfie', 'person', 'face'],
  mare: ['beach', 'sea', 'ocean', 'water', 'plaja'],
  plaja: ['beach', 'sea', 'sand'],
  munte: ['mountain', 'hill', 'rock', 'landscape'],
  zapada: ['snow', 'winter'],
  mancare: ['food', 'dish', 'meal', 'cuisine', 'pizza', 'cake'],
  tort: ['cake', 'dessert'],
  masina: ['car', 'vehicle'],
  caine: ['dog', 'pet'],
  pisica: ['cat', 'pet'],
  animal: ['dog', 'cat', 'pet', 'bird', 'horse'],
  bon: ['receipt', 'paper', 'text', 'document'],
  document: ['document', 'paper', 'text', 'receipt'],
  acte: ['document', 'paper', 'text'],
  captura: ['screenshot'],
  flori: ['flower', 'plant', 'garden'],
  parc: ['park', 'tree', 'grass', 'garden', 'playground'],
  apus: ['sunset', 'sky', 'dusk'],
  noapte: ['night', 'dark'],
  craciun: ['christmas', 'christmas tree', 'santa'],
  petrecere: ['party', 'cake', 'balloon', 'celebration']
};

const MONTHS_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function words(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(w => w.length > 1);
}

/** Textul în care se caută, pentru o poză. */
export function searchText(p: SearchablePhoto): string {
  const tags = (p.sceneTags ?? []).flatMap(t => [t, translateSceneTag(t, 'ro')]);
  const when = new Date(p.capturedAt ?? p.importedAt);
  const parts = [
    ...tags,
    p.aiDescription ?? '',
    (p.ocrText ?? '').slice(0, 400),
    ...p.personNames,
    ...(p.petNames ?? []),
    p.aside === 'document' ? 'document bon act' : p.aside === 'screenshot' ? 'captura screenshot' : '',
    p.faceCount > 0 ? 'persoana oameni person' : '',
    MONTHS_RO[when.getMonth()], MONTHS_EN[when.getMonth()], String(when.getFullYear())
  ];
  return fold(parts.join(' '));
}

/**
 * Pozele potrivite, cele mai potrivite primele. Fiecare cuvânt din căutare
 * trebuie găsit (direct sau printr-un sinonim); scorul crește cu potrivirile exacte.
 */
export function searchPhotos<P extends SearchablePhoto>(photos: readonly P[], query: string): P[] {
  const terms = words(query);
  if (!terms.length) return [];
  const scored: { p: P; score: number }[] = [];
  for (const p of photos) {
    const text = searchText(p);
    let score = 0;
    let all = true;
    for (const term of terms) {
      const options = [term, ...(SYNONYMS[term] ?? [])];
      const hit = options.find(o => text.includes(fold(o)));
      if (!hit) { all = false; break; }
      score += hit === term ? 2 : 1;
    }
    if (all) scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(x => x.p);
}
