/**
 * core/searchSynonyms.ts
 *
 * "Am cautat zapada si n-a gasit nimic, desi am o gramada de poze cu ea."
 *
 * Raportat direct, si nu era o eroare de cautare: potrivirea mergea corect, cu
 * diacritice cu tot. Problema e ca modelul de etichetare nu emisese niciodata
 * eticheta `snow` pentru acele poze — le vazuse ca `ice`, `sky`, `branch`,
 * `jacket`. Utilizatorul cauta CONCEPTUL "zapada"; motorul stie doar cuvintele
 * pe care le-a nimerit clasificatorul.
 *
 * Modulul face legatura dintre ce cauta un om si ce eticheteaza o masina. Nu e
 * un dictionar de sinonime lingvistice, ci o harta de VECINATATE: cine cauta
 * "zapada" vrea sa vada si ce e etichetat "gheata" sau "iarna"; cine cauta
 * "mancare" vrea si "tort", si "pizza".
 *
 * Legaturile merg intr-un singur sens, dinspre intrebare spre etichete. "Caine"
 * aduce si "catelus", dar cine cauta "animal" nu vrea neaparat toate pisicile
 * din biblioteca la fel de sigur — de asta fiecare intrare e scrisa explicit,
 * nu dedusa dintr-o ierarhie.
 *
 * Fara diacritice peste tot: cheia se cauta deja normalizata (vezi
 * normalizeForSearch), iar utilizatorul scrie de pe telefon, cel mai des fara.
 */

/**
 * Intrare de cautare (normalizata) -> etichete COCO/model inrudite.
 *
 * Valorile sunt etichete BRUTE ale modelului (engleza), pentru ca ele ajung in
 * `PhotoView.sceneTags`. Traducerea lor pentru afisare sta in sceneTagLabels.
 */
const SYNONYMS: Record<string, string[]> = {
  // iarna — cazul raportat
  zapada: ['snow', 'ice', 'winter', 'skis', 'snowboard', 'sled'],
  snow: ['snow', 'ice', 'winter', 'skis', 'snowboard', 'sled'],
  iarna: ['snow', 'ice', 'winter', 'skis', 'snowboard', 'jacket'],
  winter: ['snow', 'ice', 'winter', 'skis', 'snowboard', 'jacket'],
  ninsoare: ['snow', 'ice', 'winter'],
  gheata: ['ice', 'snow', 'winter', 'skating'],
  schi: ['skis', 'snowboard', 'snow'],
  sanie: ['sled', 'snow'],

  // oameni
  copil: ['person', 'child', 'boy', 'girl', 'baby'],
  copii: ['person', 'child', 'boy', 'girl', 'baby'],
  child: ['person', 'child', 'boy', 'girl', 'baby'],
  bebelus: ['baby', 'child', 'person'],
  familie: ['person', 'child', 'group'],
  portret: ['person', 'face', 'portrait'],
  oameni: ['person', 'group', 'crowd'],
  people: ['person', 'group', 'crowd'],

  // animale
  animal: ['dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'bear', 'zebra', 'elephant', 'giraffe'],
  animale: ['dog', 'cat', 'bird', 'horse', 'sheep', 'cow', 'bear'],
  caine: ['dog'],
  catel: ['dog'],
  pisica: ['cat'],
  pasare: ['bird'],
  cal: ['horse'],

  // mancare
  mancare: ['food', 'cake', 'pizza', 'sandwich', 'donut', 'hot dog', 'bowl', 'dining table', 'banana', 'apple', 'orange'],
  food: ['food', 'cake', 'pizza', 'sandwich', 'donut', 'bowl', 'dining table'],
  tort: ['cake'],
  desert: ['cake', 'donut', 'ice cream'],
  masa: ['dining table', 'food', 'bowl', 'cup'],

  // natura si locuri
  natura: ['tree', 'plant', 'grass', 'leaf', 'branch', 'flower', 'mountain', 'sky'],
  nature: ['tree', 'plant', 'grass', 'leaf', 'branch', 'flower', 'mountain', 'sky'],
  peisaj: ['mountain', 'sky', 'tree', 'sea', 'field', 'landscape'],
  munte: ['mountain', 'snow', 'sky'],
  mare: ['sea', 'beach', 'boat', 'water'],
  plaja: ['beach', 'sea', 'umbrella', 'water'],
  padure: ['tree', 'branch', 'leaf', 'plant'],
  flori: ['flower', 'plant', 'vase'],
  apus: ['sky', 'sunset', 'sun'],
  cer: ['sky', 'cloud'],

  // oras si transport
  oras: ['building', 'car', 'street', 'traffic light', 'bus'],
  masina: ['car', 'truck', 'vehicle'],
  car: ['car', 'truck', 'vehicle'],
  bicicleta: ['bicycle'],
  vacanta: ['suitcase', 'beach', 'sea', 'airplane', 'mountain'],

  // sarbatori si evenimente
  craciun: ['christmas tree', 'gift', 'cake', 'candle'],
  nunta: ['person', 'tie', 'cake', 'flower', 'dress'],
  petrecere: ['cake', 'balloon', 'wine glass', 'bottle', 'person'],
  aniversare: ['cake', 'candle', 'balloon', 'gift'],

  // interior
  acasa: ['couch', 'bed', 'chair', 'tv', 'potted plant', 'dining table'],
  birou: ['laptop', 'keyboard', 'mouse', 'monitor', 'chair'],
  sport: ['sports ball', 'tennis racket', 'skateboard', 'surfboard', 'skis', 'bicycle']
};

/**
 * Etichetele inrudite cu ce a scris utilizatorul.
 *
 * Se potriveste pe INCEPUTUL cheii, nu pe egalitate: cine tasteaza "zapa" vede
 * rezultate inainte sa termine cuvantul, la fel ca la restul cautarii.
 * Intoarce un set gol cand nu stim nimic despre acel cuvant — atunci cautarea
 * ramane exact cum era.
 */
export function relatedSceneTags(normalizedQuery: string): Set<string> {
  const out = new Set<string>();
  if (normalizedQuery.length < 3) return out;
  for (const key of Object.keys(SYNONYMS)) {
    if (key.startsWith(normalizedQuery) || normalizedQuery.startsWith(key)) {
      for (const tag of SYNONYMS[key]) out.add(tag);
    }
  }
  return out;
}

/** Doar pentru teste si pentru un eventual ecran de "ce stie sa caute". */
export const SYNONYM_KEYS = Object.keys(SYNONYMS);
