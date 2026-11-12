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
  aiDescriptionTr?: string;
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
  // Fără „pet”: aducea și pisicile la câini și invers (raportat cu captură).
  caine: ['dog', 'puppy'],
  pisica: ['cat', 'kitten'],
  animal: ['dog', 'cat', 'pet', 'bird', 'horse', 'kitten', 'puppy'],
  bon: ['receipt', 'paper', 'text', 'document'],
  document: ['document', 'paper', 'text', 'receipt'],
  acte: ['document', 'paper', 'text'],
  captura: ['screenshot'],
  flori: ['flower', 'plant', 'garden'],
  parc: ['park', 'tree', 'grass', 'garden', 'playground'],
  apus: ['sunset', 'sky', 'dusk'],
  noapte: ['night', 'dark'],
  craciun: ['christmas', 'christmas tree', 'santa'],
  petrecere: ['party', 'cake', 'balloon', 'celebration'],
  // „Aniversare” nu e o etichetă: e tort, lumânări, baloane, petrecere (raportat: nu găsea nimic potrivit).
  aniversare: ['birthday', 'cake', 'candle', 'balloon', 'party', 'tort', 'petrecere', 'celebration'],
  aniversari: ['birthday', 'cake', 'candle', 'balloon', 'party'],
  ziua: ['birthday', 'cake', 'candle', 'balloon', 'party'],
  nastere: ['birthday', 'cake', 'candle', 'balloon', 'party'],
  scoala: ['school', 'classroom', 'book'],
  gradinita: ['child', 'classroom', 'toy', 'playground'],
  soare: ['sun', 'sunny', 'sky', 'sunset'],
  cer: ['sky', 'cloud'],
  nori: ['cloud', 'sky'],
  zambet: ['smile', 'smiling', 'laugh', 'fun'],
  rade: ['laughing', 'laugh', 'smiling'],
  ras: ['laughing', 'laugh'],
  veseli: ['laughing', 'smiling', 'happy'],
  zambind: ['smile', 'smiling', 'laugh'],
  bebelus: ['baby', 'infant', 'toddler'],
  fetita: ['child', 'girl', 'baby'],
  baiat: ['child', 'boy'],
  familie: ['person', 'people', 'persoana', 'family'],
  prieteni: ['person', 'people', 'persoana', 'fun'],
  bicicleta: ['bicycle', 'bike', 'cycling'],
  minge: ['ball', 'football', 'sport'],
  fotbal: ['football', 'soccer', 'ball', 'sport'],
  piscina: ['pool', 'swimming', 'water'],
  lac: ['lake', 'water', 'river'],
  rau: ['river', 'water', 'lake'],
  padure: ['forest', 'tree', 'woodland', 'jungle'],
  copac: ['tree', 'plant'],
  iarba: ['grass', 'lawn', 'field'],
  gradina: ['garden', 'flower', 'plant', 'grass'],
  frunze: ['leaf', 'leaves', 'autumn', 'plant'],
  oras: ['city', 'building', 'street', 'skyscraper', 'town'],
  strada: ['street', 'road', 'city'],
  casa: ['house', 'home', 'building', 'room'],
  camera: ['room', 'bedroom', 'interior'],
  nunta: ['wedding', 'bride', 'dress', 'flower', 'celebration'],
  botez: ['church', 'baby', 'celebration', 'candle'],
  biserica: ['church', 'temple', 'cathedral'],
  rochie: ['dress', 'gown', 'clothing'],
  haine: ['clothing', 'dress', 'shirt', 'jacket'],
  pantofi: ['shoe', 'footwear', 'sneakers'],
  cafea: ['coffee', 'cup', 'drink'],
  vin: ['wine', 'glass', 'drink'],
  bere: ['beer', 'drink', 'glass'],
  cina: ['dinner', 'food', 'dish', 'meal', 'restaurant'],
  restaurant: ['restaurant', 'food', 'dish', 'meal'],
  jucarie: ['toy', 'teddy bear', 'doll', 'lego'],
  jucarii: ['toy', 'teddy bear', 'doll', 'lego'],
  desen: ['drawing', 'art', 'paper', 'paint'],
  carte: ['book', 'paper', 'text'],
  telefon: ['phone', 'mobile phone', 'screenshot'],
  foc: ['fire', 'flame', 'bonfire', 'candle'],
  lumini: ['light', 'lights', 'night', 'christmas'],
  ploaie: ['rain', 'umbrella', 'cloud'],
  pasare: ['bird'],
  cal: ['horse'],
  avion: ['airplane', 'aircraft', 'airport'],
  tren: ['train', 'railway', 'station'],
  barca: ['boat', 'ship', 'water'],
  vacanta: ['beach', 'sea', 'mountain', 'pool', 'travel', 'vara']
};

/** Cuvintele de legătură nu se caută: „copil pe plajă la apus” = copil + plajă + apus. */
const STOP = new Set(['pe', 'la', 'in', 'cu', 'de', 'si', 'din', 'un', 'o', 'cel', 'cea', 'lui', 'ei', 'al', 'ale', 'sau',
  'the', 'a', 'an', 'at', 'on', 'with', 'of', 'and', 'or', 'by', 'my']);

const SEASONS_RO = ['iarna', 'iarna', 'primavara', 'primavara', 'primavara', 'vara', 'vara', 'vara', 'toamna', 'toamna', 'toamna', 'iarna'];
const SEASONS_EN = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

const MONTHS_RO = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Cuvântul și sinonimele lui, cu formele românești aduse la cuvântul de bază:
 * „pisici”, „pisicile”, „pisicii” → „pisica”; „câini” → „câine”; „torturi” → „tort”.
 * Fără asta, pluralul nu găsea nimic din ce se vede în poze.
 */
const ENDINGS = ['ilor', 'elor', 'ului', 'ile', 'uri', 'lor', 'ii', 'le', 'ul', 'ei', 'i', 'e', 'a'];
const TAILS = ['', 'a', 'e', 'i', 'ie'];
export function termOptions(term: string): string[] {
  const direct = SYNONYMS[term];
  if (direct) return [term, ...direct];
  for (const end of ENDINGS) {
    if (term.length - end.length < 3 || !term.endsWith(end)) continue;
    const stem = term.slice(0, -end.length);
    for (const tail of TAILS) {
      const key = stem + tail;
      if (SYNONYMS[key]) return [term, key, ...SYNONYMS[key]];
    }
  }
  return [term];
}

function words(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
}

/** Textul în care se caută, pentru o poză. */
export function searchText(p: SearchablePhoto, withOcr = true): string {
  const tags = (p.sceneTags ?? []).flatMap(t => [t, translateSceneTag(t, 'ro')]);
  const when = new Date(p.capturedAt ?? p.importedAt);
  const parts = [
    ...tags,
    p.aiDescription ?? '',
    p.aiDescriptionTr ?? '',
    withOcr ? (p.ocrText ?? '').slice(0, 400) : '',
    ...p.personNames,
    ...(p.petNames ?? []),
    p.aside === 'document' ? 'document bon act' : p.aside === 'screenshot' ? 'captura screenshot' : '',
    p.faceCount > 0 ? 'persoana oameni person' : '',
    MONTHS_RO[when.getMonth()], MONTHS_EN[when.getMonth()], SEASONS_RO[when.getMonth()], SEASONS_EN[when.getMonth()], String(when.getFullYear())
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
  const scored: { p: P; score: number; t: number; seen: boolean }[] = [];
  for (const p of photos) {
    // Potrivire de la începutul cuvântului: „Ana” nu mai găsește „banana”, „Ioana”,
    // „canapea” (raportat). Prefixul rămâne: „pisic” găsește „pisică”.
    const text = ' ' + searchText(p).replace(/[^a-z0-9]+/g, ' ');
    const names = ' ' + fold(p.personNames.join(' ')).replace(/[^a-z0-9]+/g, ' ');
    let score = 0;
    let all = true;
    for (const term of terms) {
      const options = termOptions(term);
      const hit = options.find(o => text.includes(' ' + fold(o)));
      if (!hit) { all = false; break; }
      score += hit === term ? 2 : 1;
      // Persoana numită exact cum ai scris: prima.
      if (names.includes(' ' + fold(term) + ' ') || names.endsWith(' ' + fold(term))) score += 6;
    }
    if (all) {
      // „Văzut” = cuvintele se regăsesc în ce e ÎN poză (etichete, descriere, oameni), nu doar
      // în textul citit de pe ea. Raportat: „poze cu pisici” întorcea un bon de mâncare pentru pisici.
      const visual = ' ' + searchText(p, false).replace(/[^a-z0-9]+/g, ' ');
      const seen = terms.every(term => termOptions(term).some(o => visual.includes(' ' + fold(o))));
      scored.push({ p, score, t: p.capturedAt ?? p.importedAt, seen });
    }
  }
  // La scor egal, cele mai noi întâi (nu ordinea importului).
  // Dacă există poze în care subiectul se vede, cele găsite doar după textul de pe ele rămân afară;
  // când nu există (ex. numele unui magazin), textul citit e tot ce avem și se întoarce el.
  const pool = scored.some(x => x.seen) ? scored.filter(x => x.seen) : scored;
  return pool.sort((a, b) => b.score - a.score || b.t - a.t).map(x => x.p);
}

/**
 * O potrivire „doar din text”: poza e un document/captură, sau cuvântul apare doar în
 * textul citit din ea (OCR), nu în oameni, etichete sau descriere. Raportat: căutarea
 * „Ami” arăta analizele medicale cu numele ei amestecate printre poze.
 */
export function isTextOnlyMatch(p: SearchablePhoto, query: string): boolean {
  if (p.aside === 'document' || p.aside === 'screenshot') return true;
  const terms = words(query);
  if (!terms.length || !p.ocrText) return false;
  const ocr = fold(p.ocrText.slice(0, 400));
  const rest = fold(searchText({ ...p, ocrText: '' }));
  return terms.some(t => {
    const options = [t, ...(SYNONYMS[t] ?? [])].map(fold);
    return options.some(o => ocr.includes(o)) && !options.some(o => rest.includes(o));
  });
}
