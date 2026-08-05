/**
 * core/sceneTagLabels.ts
 * PhotoView.sceneTags stocheaza etichetele brute in engleza, exact cum le
 * intoarce detectorul de obiecte CenterNet (COCO-80 — vezi faceAnalysis.worker.ts,
 * `result.object.map(o => o.label)`). Pastram formatul intern neschimbat
 * (stabil pentru DB/export XMP, unde etichetele in engleza sunt un vocabular
 * standard recunoscut de alte unelte foto), dar traducem STRICT la afisare
 * (SceneTagFilter, PhotoInfoTabs) si la potrivirea cautarii text (store.ts).
 */
export const SCENE_TAG_LABELS_RO: Record<string, string> = {
  person: 'persoana', bicycle: 'bicicleta', car: 'masina', motorcycle: 'motocicleta',
  airplane: 'avion', bus: 'autobuz', train: 'tren', truck: 'camion', boat: 'barca',
  'traffic light': 'semafor', 'fire hydrant': 'hidrant', 'stop sign': 'indicator stop',
  'parking meter': 'parcometru', bench: 'banca', bird: 'pasare', cat: 'pisica', dog: 'caine',
  horse: 'cal', sheep: 'oaie', cow: 'vaca', elephant: 'elefant', bear: 'urs', zebra: 'zebra',
  giraffe: 'girafa', backpack: 'rucsac', umbrella: 'umbrela', handbag: 'geanta', tie: 'cravata',
  suitcase: 'valiza', frisbee: 'frisbee', skis: 'schiuri', snowboard: 'snowboard',
  'sports ball': 'minge', kite: 'zmeu', 'baseball bat': 'bata de baseball',
  'baseball glove': 'manusa de baseball', skateboard: 'skateboard', surfboard: 'placa de surf',
  'tennis racket': 'racheta de tenis', bottle: 'sticla', 'wine glass': 'pahar de vin', cup: 'cana',
  fork: 'furculita', knife: 'cutit', spoon: 'lingura', bowl: 'bol', banana: 'banana', apple: 'mar',
  sandwich: 'sandvis', orange: 'portocala', broccoli: 'broccoli', carrot: 'morcov',
  'hot dog': 'hot dog', pizza: 'pizza', donut: 'gogoasa', cake: 'tort', chair: 'scaun',
  couch: 'canapea', 'potted plant': 'planta in ghiveci', bed: 'pat', 'dining table': 'masa',
  toilet: 'toaleta', tv: 'televizor', laptop: 'laptop', mouse: 'mouse', remote: 'telecomanda',
  keyboard: 'tastatura', 'cell phone': 'telefon mobil', microwave: 'cuptor cu microunde',
  oven: 'cuptor', toaster: 'prajitor de paine', sink: 'chiuveta', refrigerator: 'frigider',
  book: 'carte', clock: 'ceas', vase: 'vaza', scissors: 'foarfeca', 'teddy bear': 'ursulet de plus',
  'hair drier': 'uscator de par', toothbrush: 'periuta de dinti'
};

/** Traduce o eticheta COCO (engleza, forma stocata) in romana pentru afisare — negasita = intoarsa neschimbata. */
export function translateSceneTag(tag: string, locale: 'ro' | 'en'): string {
  if (locale === 'en') return tag;
  return SCENE_TAG_LABELS_RO[tag] ?? tag;
}

/**
 * Fara diacritice + minuscule — utilizatorii scriu des "pisica" in loc de
 * "pisică" (tastatura fara diacritice e larg raspandita), asa ca normalizam
 * AMBELE parti (interogare si tinta) inainte de comparatie, altfel cautarea
 * ar rata potriviri evidente pentru utilizator.
 */
export function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
