/**
 * core/sceneTagLabels.ts
 * PhotoView.sceneTags stocheaza etichetele brute in engleza, exact cum le
 * intoarce detectorul de scena: CenterNet (COCO-80, lowercase — vezi
 * faceAnalysis.worker.ts, `result.object.map(o => o.label)`) pe web, sau ML
 * Kit Image Labeling (taxonomie Open Images, Title Case — vezi
 * core/nativeImageLabeling.ts) pe Android nativ. Doua vocabulare diferite,
 * pastrate NESCHIMBATE la stocare (stabil pentru DB/export XMP, unde
 * etichetele in engleza sunt un standard recunoscut de alte unelte foto);
 * traducem STRICT la afisare (SceneTagFilter, PhotoInfoTabs) si la
 * potrivirea cautarii text (store.ts), cu potrivire case-insensitive mai jos
 * ca sa acopere ambele forme fara doua harti separate.
 *
 * Harta de mai jos NU e exhaustiva — Open Images are peste 400 de etichete,
 * imposibil de acoperit complet dintr-o trecere. Acopera cele mai frecvente
 * intalnite pe poze obisnuite (persoane, natura, mancare, evenimente,
 * animale, obiecte casnice); orice eticheta negasita ramane afisata
 * neschimbata, in engleza (fallback sigur, vezi translateSceneTag mai jos).
 */
export const SCENE_TAG_LABELS_RO: Record<string, string> = {
  // COCO-80 (web, CenterNet)
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
  'hair drier': 'uscator de par', toothbrush: 'periuta de dinti',

  // ML Kit Image Labeling / Open Images (native, cele mai frecvente etichete generice)
  // — oameni, expresii, imbracaminte
  selfie: 'selfie', photograph: 'fotografie', snapshot: 'instantaneu', photography: 'fotografie',
  vacation: 'vacanta', fun: 'distractie', leisure: 'relaxare', recreation: 'recreere',
  interaction: 'interactiune', smile: 'zambet', 'facial expression': 'expresie faciala',
  happy: 'fericire', eyewear: 'ochelari', glasses: 'ochelari', skin: 'piele',
  hairstyle: 'coafura', beard: 'barba', 'human body': 'corp uman', muscle: 'musculatura',
  gesture: 'gest', standing: 'in picioare', sitting: 'asezat', walking: 'mers', running: 'alergare',
  't-shirt': 'tricou', shirt: 'camasa', shorts: 'pantaloni scurti', jeans: 'blugi', dress: 'rochie',
  jacket: 'geaca', coat: 'palton', hat: 'palarie', cap: 'sapca', shoe: 'pantof', sneakers: 'adidasi',
  clothing: 'imbracaminte', fashion: 'moda', sportswear: 'echipament sportiv', uniform: 'uniforma',
  baby: 'bebelus', child: 'copil', toddler: 'copil mic', family: 'familie', friendship: 'prietenie',
  team: 'echipa', crowd: 'multime', group: 'grup', people: 'oameni', portrait: 'portret',

  // natura, peisaj, vreme
  water: 'apa', sky: 'cer', cloud: 'nor', sea: 'mare', ocean: 'ocean', lake: 'lac', river: 'rau',
  beach: 'plaja', sand: 'nisip', wave: 'val', sunset: 'apus', sunrise: 'rasarit',
  sunlight: 'lumina soarelui', horizon: 'orizont', nature: 'natura', landscape: 'peisaj',
  'natural landscape': 'peisaj natural', mountain: 'munte', hill: 'deal', forest: 'padure',
  tree: 'copac', plant: 'planta', flower: 'floare', 'flowering plant': 'planta cu flori',
  grass: 'iarba', leaf: 'frunza', branch: 'creanga', snow: 'zapada', winter: 'iarna', ice: 'gheata',
  rain: 'ploaie', fog: 'ceata',

  // orase, cladiri, vehicule
  building: 'cladire', house: 'casa', architecture: 'arhitectura', city: 'oras',
  skyscraper: 'zgarie-nori', street: 'strada', road: 'drum', sidewalk: 'trotuar', bridge: 'pod',
  room: 'camera', 'interior design': 'design interior', furniture: 'mobila', table: 'masa',
  sofa: 'canapea', kitchen: 'bucatarie', bathroom: 'baie', vehicle: 'vehicul', wheel: 'roata',
  bike: 'bicicleta', 'motor vehicle': 'autovehicul',

  // animale
  animal: 'animal', wildlife: 'animal salbatic', pet: 'animal de companie', puppy: 'catelus',
  kitten: 'pisicuta', fish: 'peste', insect: 'insecta',

  // mancare/bautura
  food: 'mancare', meal: 'masa', dish: 'fel de mancare', cuisine: 'bucatarie', dessert: 'desert',
  fruit: 'fruct', vegetable: 'legume', drink: 'bautura', beverage: 'bautura', coffee: 'cafea',
  tea: 'ceai', wine: 'vin', restaurant: 'restaurant', cooking: 'gatit',

  // evenimente/obiecte
  event: 'eveniment', party: 'petrecere', wedding: 'nunta', holiday: 'vacanta', christmas: 'craciun',
  birthday: 'zi de nastere', celebration: 'sarbatoare', festival: 'festival', ceremony: 'ceremonie',
  toy: 'jucarie', doll: 'papusa', balloon: 'balon', gift: 'cadou',

  // sport, muzica, arta
  sport: 'sport', ball: 'minge', game: 'joc', football: 'fotbal', basketball: 'baschet',
  tennis: 'tenis', swimming: 'inot', fitness: 'fitness', 'musical instrument': 'instrument muzical',
  music: 'muzica', guitar: 'chitara', piano: 'pian', concert: 'concert', dance: 'dans', art: 'arta',
  painting: 'pictura', drawing: 'desen',

  // tehnologie/text
  text: 'text', font: 'font', logo: 'logo', product: 'produs', electronics: 'electronice',
  'mobile phone': 'telefon mobil', smartphone: 'smartphone', computer: 'computer',
  screen: 'ecran', camera: 'aparat foto', technology: 'tehnologie'
};

/**
 * Traduce o eticheta de scena (engleza, forma stocata) in romana pentru afisare
 * — negasita = intoarsa neschimbata. Potrivire case-insensitive: COCO (web) e
 * deja lowercase, dar ML Kit Image Labeling (native) intoarce Title Case
 * ("Fun", "Skin") — fara normalizare aici, acele etichete n-ar gasi NICIODATA
 * cheia lowercase din SCENE_TAG_LABELS_RO, chiar daca exista (bug real gasit
 * de feedback direct: toate etichetele native aparea netraduse).
 */
export function translateSceneTag(tag: string, locale: 'ro' | 'en'): string {
  if (locale === 'en') return tag;
  return SCENE_TAG_LABELS_RO[tag.toLowerCase()] ?? tag;
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
