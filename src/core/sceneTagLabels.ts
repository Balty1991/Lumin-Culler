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
 * Harta de mai jos ramane, prin natura ei, incompleta: Google nu publica
 * lista exacta a celor ~400 de etichete pe care modelul bundle-uit ML Kit
 * Image Labeling chiar le poate intoarce (nu e un fisier labelmap.txt simplu
 * ca la vechiul TFLite — vezi istoricul git). Ce urmeaza e o extindere mare,
 * bazata pe taxonomia publica Open Images (sursa modelului) si pe etichete
 * observate uzual la acest tip de model — cateva sute de concepte, mult
 * peste ce apare de obicei pe poze de familie/calatorie/eveniment. Orice
 * eticheta tot negasita ramane afisata neschimbata, in engleza (fallback
 * sigur, vezi translateSceneTag mai jos) — nu blocheaza nimic, doar nu e
 * inca tradusa.
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

  // ML Kit Image Labeling / Open Images (native) — oameni, expresii, imbracaminte
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
  // — anatomie/portret suplimentar
  forehead: 'frunte', chin: 'barbie', cheek: 'obraz', nose: 'nas', eyebrow: 'sprinceana',
  eyelash: 'gene', jaw: 'maxilar', neck: 'gat', ear: 'ureche', lip: 'buze', tooth: 'dinte',
  'facial hair': 'barba/mustata', mustache: 'mustata', 'long hair': 'par lung',
  'blond hair': 'par blond', 'black hair': 'par negru', wrinkle: 'rid', headgear: 'acoperamant cap',
  sunglasses: 'ochelari de soare', earrings: 'cercei', necklace: 'colier', jewellery: 'bijuterii',
  ring: 'inel', bracelet: 'bratara', watch: 'ceas de mana', makeup: 'machiaj',
  // — imbracaminte suplimentar
  'formal wear': 'tinuta eleganta', suit: 'costum', blazer: 'sacou', sweater: 'pulover',
  hoodie: 'hanorac', scarf: 'esarfa', glove: 'manusa', sock: 'soseta', belt: 'curea',
  boot: 'cizma', sandal: 'sanda', 'high heels': 'tocuri', swimwear: 'costum de baie',
  bikini: 'bikini', costume: 'costum tematic', 'wedding dress': 'rochie de mireasa',
  pajamas: 'pijama',
  // — activitati/pose
  jumping: 'saritura', dancing: 'dans', singing: 'cantat', laughing: 'ras', crying: 'plans',
  kissing: 'sarut', hugging: 'imbratisare', waving: 'gest de salut', posing: 'pozat',
  sleeping: 'somn', eating: 'mancat', drinking: 'baut', reading: 'citit', writing: 'scris',
  playing: 'joaca',

  // natura, peisaj, vreme
  water: 'apa', sky: 'cer', cloud: 'nor', sea: 'mare', ocean: 'ocean', lake: 'lac', river: 'rau',
  beach: 'plaja', sand: 'nisip', wave: 'val', sunset: 'apus', sunrise: 'rasarit',
  sunlight: 'lumina soarelui', horizon: 'orizont', nature: 'natura', landscape: 'peisaj',
  'natural landscape': 'peisaj natural', mountain: 'munte', hill: 'deal', forest: 'padure',
  tree: 'copac', plant: 'planta', flower: 'floare', 'flowering plant': 'planta cu flori',
  grass: 'iarba', leaf: 'frunza', branch: 'creanga', snow: 'zapada', winter: 'iarna', ice: 'gheata',
  rain: 'ploaie', fog: 'ceata',
  // — natura extinsa
  waterfall: 'cascada', canyon: 'canion', desert: 'desert', valley: 'vale', cave: 'pestera',
  cliff: 'stanca', island: 'insula', volcano: 'vulcan', glacier: 'ghetar', rainbow: 'curcubeu',
  lightning: 'fulger', storm: 'furtuna', wind: 'vant', dew: 'roua', dust: 'praf',
  meadow: 'poiana', prairie: 'prerie', savanna: 'savana', jungle: 'jungla',
  wilderness: 'salbaticie', garden: 'gradina', park: 'parc', path: 'poteca', trail: 'traseu',
  rock: 'stanca', stone: 'piatra', pebble: 'pietricica', cactus: 'cactus', 'palm tree': 'palmier',
  pond: 'iaz', stream: 'parau', coast: 'coasta', shore: 'tarm', pier: 'chei', dock: 'doc',
  // — cer/vreme suplimentar
  dusk: 'amurg', dawn: 'zori', twilight: 'amurg', moon: 'luna', star: 'stea', galaxy: 'galaxie',
  aurora: 'aurora boreala', thunderstorm: 'furtuna cu tunete', hail: 'grindina', drizzle: 'burnita',

  // orase, cladiri, vehicule
  building: 'cladire', house: 'casa', architecture: 'arhitectura', city: 'oras',
  skyscraper: 'zgarie-nori', street: 'strada', road: 'drum', sidewalk: 'trotuar', bridge: 'pod',
  room: 'camera', 'interior design': 'design interior', furniture: 'mobila', table: 'masa',
  sofa: 'canapea', kitchen: 'bucatarie', bathroom: 'baie', vehicle: 'vehicul', wheel: 'roata',
  bike: 'bicicleta', 'motor vehicle': 'autovehicul',
  // — cladiri/urban suplimentar
  apartment: 'apartament', cottage: 'cabana', cabin: 'cabana', castle: 'castel', tower: 'turn',
  monument: 'monument', statue: 'statuie', church: 'biserica', cathedral: 'catedrala',
  temple: 'templu', mosque: 'moschee', museum: 'muzeu', library: 'biblioteca', school: 'scoala',
  university: 'universitate', hospital: 'spital', hotel: 'hotel', office: 'birou',
  factory: 'fabrica', warehouse: 'depozit', market: 'piata', mall: 'mall', shop: 'magazin',
  store: 'magazin', stadium: 'stadion', arena: 'arena', gym: 'sala de fitness', pool: 'piscina',
  'swimming pool': 'piscina', playground: 'loc de joaca', fence: 'gard', gate: 'poarta',
  staircase: 'scara', stairs: 'scari', balcony: 'balcon', terrace: 'terasa', courtyard: 'curte',
  fountain: 'fantana', sculpture: 'sculptura', mural: 'pictura murala', graffiti: 'graffiti',
  billboard: 'panou publicitar', lamp: 'lampa', 'street light': 'felinar', tunnel: 'tunel',
  railway: 'cale ferata', platform: 'peron', airport: 'aeroport', port: 'port',
  // — vehicule suplimentar
  sedan: 'berlina', convertible: 'decapotabila', 'pickup truck': 'pick-up', van: 'duba',
  trailer: 'remorca', tractor: 'tractor', helicopter: 'elicopter', jet: 'avion cu reactie',
  glider: 'planor', 'hot air balloon': 'balon cu aer cald', yacht: 'iaht', canoe: 'canoe',
  kayak: 'caiac', sailboat: 'barca cu panze', ferry: 'feribot', 'cruise ship': 'vas de croaziera',
  submarine: 'submarin', scooter: 'trotineta', moped: 'moped', wheelchair: 'scaun cu rotile',
  stroller: 'carucior', tire: 'anvelopa', headlight: 'far', 'license plate': 'numar de inmatriculare',
  engine: 'motor',
  // — mobila/interior suplimentar
  cabinet: 'dulap', shelf: 'raft', drawer: 'sertar', mirror: 'oglinda', curtain: 'perdea',
  carpet: 'covor', rug: 'covor', pillow: 'perna', cushion: 'perna', blanket: 'patura',
  chandelier: 'candelabru', fireplace: 'semineu', wallpaper: 'tapet', tile: 'gresie',
  ceiling: 'tavan', floor: 'podea', doorway: 'cadru de usa', 'home appliance': 'electrocasnic',
  fan: 'ventilator', heater: 'calorifer', 'air conditioning': 'aer conditionat',
  thermostat: 'termostat',

  // animale
  animal: 'animal', wildlife: 'animal salbatic', pet: 'animal de companie', puppy: 'catelus',
  kitten: 'pisicuta', fish: 'peste', insect: 'insecta',
  // — animale extinse
  'dog breed': 'rasa de caine', 'cat breed': 'rasa de pisica', mammal: 'mamifer',
  vertebrate: 'vertebrat', carnivore: 'carnivor', rabbit: 'iepure', hamster: 'hamster',
  rodent: 'rozator', reptile: 'reptila', snake: 'sarpe', lizard: 'soparla', turtle: 'testoasa',
  frog: 'broasca', butterfly: 'fluture', bee: 'albina', spider: 'paianjen', ant: 'furnica',
  dragonfly: 'libelula', chicken: 'gaina', duck: 'rata', goose: 'gasca', owl: 'bufnita',
  eagle: 'vultur', parrot: 'papagal', penguin: 'pinguin', dolphin: 'delfin', whale: 'balena',
  shark: 'rechin', lion: 'leu', tiger: 'tigru', monkey: 'maimuta', deer: 'cerb', fox: 'vulpe',
  wolf: 'lup', squirrel: 'veverita', hedgehog: 'arici', snail: 'melc', jellyfish: 'meduza',
  camel: 'camila', pig: 'porc', goat: 'capra', donkey: 'magar', llama: 'lama',
  kangaroo: 'cangur', koala: 'koala', panda: 'panda',

  // mancare/bautura
  food: 'mancare', meal: 'masa', dish: 'fel de mancare', cuisine: 'bucatarie', dessert: 'desert',
  fruit: 'fruct', vegetable: 'legume', drink: 'bautura', beverage: 'bautura', coffee: 'cafea',
  tea: 'ceai', wine: 'vin', restaurant: 'restaurant', cooking: 'gatit',
  // — mancare extinsa
  bread: 'paine', cheese: 'branza', meat: 'carne', beef: 'carne de vita', pork: 'carne de porc',
  seafood: 'fructe de mare', shrimp: 'creveti', lobster: 'homar', crab: 'crab', egg: 'ou',
  rice: 'orez', pasta: 'paste', noodle: 'taitei', soup: 'supa', salad: 'salata', sauce: 'sos',
  spice: 'condiment', herb: 'ierburi aromatice', sugar: 'zahar', salt: 'sare',
  chocolate: 'ciocolata', candy: 'bomboane', cookie: 'fursec', 'ice cream': 'inghetata',
  pancake: 'clatita', waffle: 'vafa', muffin: 'briosa', croissant: 'croasant', bagel: 'covrig',
  taco: 'taco', burrito: 'burrito', sushi: 'sushi', dumpling: 'colturasi', curry: 'curry',
  barbecue: 'gratar', grill: 'gratar', picnic: 'picnic', buffet: 'bufet', 'fast food': 'fast-food',
  snack: 'gustare', beer: 'bere', cocktail: 'cocktail', juice: 'suc', soda: 'sifon',
  teapot: 'ceainic', kettle: 'fierbator', tablecloth: 'fata de masa', napkin: 'servetel',
  tray: 'tava', plate: 'farfurie', platter: 'platou',

  // evenimente/obiecte
  event: 'eveniment', party: 'petrecere', wedding: 'nunta', holiday: 'vacanta', christmas: 'craciun',
  birthday: 'zi de nastere', celebration: 'sarbatoare', festival: 'festival', ceremony: 'ceremonie',
  toy: 'jucarie', doll: 'papusa', balloon: 'balon', gift: 'cadou',
  // — evenimente/obiecte suplimentar
  fireworks: 'artificii', candle: 'lumanare', ribbon: 'panglica', decoration: 'decoratiune',
  ornament: 'ornament', wreath: 'coronita', banner: 'banner', flag: 'steag', trophy: 'trofeu',
  medal: 'medalie', certificate: 'certificat', invitation: 'invitatie', envelope: 'plic',
  confetti: 'confetti', mask: 'masca', circus: 'circ', carnival: 'carnaval', parade: 'parada',
  fair: 'targ',

  // sport, muzica, arta
  sport: 'sport', ball: 'minge', game: 'joc', football: 'fotbal', basketball: 'baschet',
  tennis: 'tenis', swimming: 'inot', fitness: 'fitness', 'musical instrument': 'instrument muzical',
  music: 'muzica', guitar: 'chitara', piano: 'pian', concert: 'concert', dance: 'dans', art: 'arta',
  painting: 'pictura', drawing: 'desen',
  // — sport extinse
  'ice hockey': 'hochei pe gheata', hockey: 'hochei', volleyball: 'volei', baseball: 'baseball',
  golf: 'golf', boxing: 'box', wrestling: 'lupte', cycling: 'ciclism', skiing: 'schi',
  snowboarding: 'snowboarding', surfing: 'surfing', skating: 'patinaj',
  'ice skating': 'patinaj pe gheata', climbing: 'catarare', hiking: 'drumetie', camping: 'camping',
  fishing: 'pescuit', hunting: 'vanatoare', archery: 'tir cu arcul', gymnastics: 'gimnastica',
  athletics: 'atletism', marathon: 'maraton', race: 'cursa', competition: 'competitie',
  championship: 'campionat', tournament: 'turneu', coach: 'antrenor', referee: 'arbitru',
  athlete: 'atlet',
  // — muzica/arta suplimentar
  violin: 'vioara', drum: 'toba', trumpet: 'trompeta', saxophone: 'saxofon',
  microphone: 'microfon', speaker: 'boxa', orchestra: 'orchestra', band: 'trupa', choir: 'cor',
  opera: 'opera', theater: 'teatru', ballet: 'balet', pottery: 'olarit', craft: 'artizanat',
  calligraphy: 'caligrafie', exhibition: 'expozitie', gallery: 'galerie',

  // tehnologie/text
  text: 'text', font: 'font', logo: 'logo', product: 'produs', electronics: 'electronice',
  'mobile phone': 'telefon mobil', smartphone: 'smartphone', computer: 'computer',
  screen: 'ecran', camera: 'aparat foto', technology: 'tehnologie',
  // — tehnologie suplimentar
  television: 'televizor', headphones: 'casti', earphones: 'casti in-ear', tablet: 'tableta',
  printer: 'imprimanta', router: 'router', cable: 'cablu', charger: 'incarcator',
  battery: 'baterie', drone: 'drona', robot: 'robot', satellite: 'satelit', antenna: 'antena',
  monitor: 'monitor', projector: 'proiector', telescope: 'telescop', microscope: 'microscop',
  // — text/simboluri
  number: 'numar', letter: 'litera', symbol: 'simbol', icon: 'pictograma', emblem: 'emblema',
  badge: 'insigna', stamp: 'stampila', coin: 'moneda', currency: 'bani', map: 'harta',
  chart: 'grafic', graph: 'grafic', diagram: 'diagrama', calendar: 'calendar',
  newspaper: 'ziar', magazine: 'revista',
  // — materiale/texturi
  pattern: 'model', texture: 'textura', wood: 'lemn', metal: 'metal', glass: 'sticla',
  plastic: 'plastic', fabric: 'material textil', textile: 'textil', leather: 'piele naturala',
  silk: 'matase', cotton: 'bumbac', wool: 'lana', denim: 'denim', lace: 'dantela',
  // — concepte/emotii
  love: 'dragoste', romance: 'romantism', adventure: 'aventura', freedom: 'libertate',
  meditation: 'meditatie', yoga: 'yoga', wellness: 'wellness', health: 'sanatate',
  medicine: 'medicina', education: 'educatie', learning: 'invatare', business: 'afaceri',
  work: 'munca', meeting: 'intalnire', conference: 'conferinta', teamwork: 'lucru in echipa',
  success: 'succes'
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
 * Etichete utile pentru traducere/cautare, dar care ar face nume de folder
 * proaste la exportul organizat pe categorii (core/exportPhotos.ts,
 * folderLabel): expresii, poze/gesturi, imbracaminte, anatomie, materiale si
 * concepte abstracte nu spun nimic despre SUBIECTUL fizic al pozei — un
 * folder numit "Distractie" sau "Material textil" e mult mai putin util
 * decat "Parc", "Plaja" sau "Pisici". Lista corespunde exact sectiunilor
 * marcate mai sus in SCENE_TAG_LABELS_RO (COCO-80 si categoriile de
 * natura/cladiri/vehicule/animale/mancare/evenimente ramase AFARA din lista
 * de mai jos sunt considerate subiecte concrete, deci folosibile).
 */
const NON_FOLDER_SCENE_TAGS = new Set<string>([
  'selfie', 'photograph', 'snapshot', 'photography', 'vacation', 'fun', 'leisure', 'recreation',
  'interaction', 'smile', 'facial expression', 'happy', 'eyewear', 'glasses', 'skin', 'hairstyle',
  'beard', 'human body', 'muscle', 'gesture', 'standing', 'sitting', 'walking', 'running',
  't-shirt', 'shirt', 'shorts', 'jeans', 'dress', 'jacket', 'coat', 'hat', 'cap', 'shoe', 'sneakers',
  'clothing', 'fashion', 'sportswear', 'uniform', 'baby', 'child', 'toddler', 'family', 'friendship',
  'team', 'crowd', 'group', 'people', 'portrait',
  'forehead', 'chin', 'cheek', 'nose', 'eyebrow', 'eyelash', 'jaw', 'neck', 'ear', 'lip', 'tooth',
  'facial hair', 'mustache', 'long hair', 'blond hair', 'black hair', 'wrinkle', 'headgear',
  'sunglasses', 'earrings', 'necklace', 'jewellery', 'ring', 'bracelet', 'watch', 'makeup',
  'formal wear', 'suit', 'blazer', 'sweater', 'hoodie', 'scarf', 'glove', 'sock', 'belt', 'boot',
  'sandal', 'high heels', 'swimwear', 'bikini', 'costume', 'wedding dress', 'pajamas',
  'jumping', 'dancing', 'singing', 'laughing', 'crying', 'kissing', 'hugging', 'waving', 'posing',
  'sleeping', 'eating', 'drinking', 'reading', 'writing', 'playing',
  'pattern', 'texture', 'wood', 'metal', 'glass', 'plastic', 'fabric', 'textile', 'leather', 'silk',
  'cotton', 'wool', 'denim', 'lace',
  'love', 'romance', 'adventure', 'freedom', 'meditation', 'yoga', 'wellness', 'health', 'medicine',
  'education', 'learning', 'business', 'work', 'meeting', 'conference', 'teamwork', 'success',
  'number', 'letter', 'symbol', 'icon', 'emblem', 'badge', 'stamp', 'coin', 'currency', 'map',
  'chart', 'graph', 'diagram', 'calendar', 'newspaper', 'magazine',
  'font', 'logo', 'product', 'electronics', 'technology'
]);

/**
 * Prima eticheta de scena FOLOSIBILA ca nume de folder (vezi
 * NON_FOLDER_SCENE_TAGS mai sus) — etichetele vin deja sortate descrescator
 * dupa incredere (CenterNet/ML Kit, vezi header-ul fisierului), deci prima
 * potrivire ramane si cea mai relevanta. Absent = nicio eticheta concreta
 * disponibila (lista goala sau doar concepte abstracte).
 */
export function pickFolderSceneTag(tags: string[] | undefined): string | undefined {
  return tags?.find(t => !NON_FOLDER_SCENE_TAGS.has(t.toLowerCase()));
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
