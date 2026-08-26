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
const SCENE_TAG_LABELS_RO: Record<string, string> = {
  // COCO-80 (web, CenterNet)
  person: 'persoană', bicycle: 'bicicletă', car: 'mașină', motorcycle: 'motocicletă',
  airplane: 'avion', bus: 'autobuz', train: 'tren', truck: 'camion', boat: 'barcă',
  'traffic light': 'semafor', 'fire hydrant': 'hidrant', 'stop sign': 'indicator stop',
  'parking meter': 'parcometru', bench: 'bancă', bird: 'pasăre', cat: 'pisică', dog: 'câine',
  horse: 'cal', sheep: 'oaie', cow: 'vacă', elephant: 'elefant', bear: 'urs', zebra: 'zebră',
  giraffe: 'girafă', backpack: 'rucsac', umbrella: 'umbrelă', handbag: 'geantă', tie: 'cravată',
  suitcase: 'valiză', frisbee: 'frisbee', skis: 'schiuri', snowboard: 'snowboard',
  'sports ball': 'minge', kite: 'zmeu', 'baseball bat': 'bâtă de baseball',
  'baseball glove': 'mănușă de baseball', skateboard: 'skateboard', surfboard: 'placă de surf',
  'tennis racket': 'rachetă de tenis', bottle: 'sticlă', 'wine glass': 'pahar de vin', cup: 'cană',
  fork: 'furculiță', knife: 'cuțit', spoon: 'lingură', bowl: 'bol', banana: 'banana', apple: 'măr',
  sandwich: 'sandviș', orange: 'portocală', broccoli: 'broccoli', carrot: 'morcov',
  'hot dog': 'hot dog', pizza: 'pizza', donut: 'gogoașă', cake: 'tort', chair: 'scaun',
  couch: 'canapea', 'potted plant': 'plantă în ghiveci', bed: 'pat', 'dining table': 'masă',
  toilet: 'toaletă', tv: 'televizor', laptop: 'laptop', mouse: 'mouse', remote: 'telecomandă',
  keyboard: 'tastatură', 'cell phone': 'telefon mobil', microwave: 'cuptor cu microunde',
  oven: 'cuptor', toaster: 'prăjitor de pâine', sink: 'chiuvetă', refrigerator: 'frigider',
  book: 'carte', clock: 'ceas', vase: 'vază', scissors: 'foarfecă', 'teddy bear': 'ursuleț de pluș',
  'hair drier': 'uscător de păr', toothbrush: 'periuță de dinți',

  // ML Kit Image Labeling / Open Images (native) — oameni, expresii, imbracaminte
  selfie: 'selfie', photograph: 'fotografie', snapshot: 'instantaneu', photography: 'fotografie',
  vacation: 'vacanță', fun: 'distracție', leisure: 'relaxare', recreation: 'recreere',
  interaction: 'interacțiune', smile: 'zâmbet', 'facial expression': 'expresie facială',
  happy: 'fericire', eyewear: 'ochelari', glasses: 'ochelari', skin: 'piele',
  hairstyle: 'coafură', beard: 'barbă', 'human body': 'corp uman', muscle: 'musculatură',
  gesture: 'gest', standing: 'în picioare', sitting: 'așezat', walking: 'mers', running: 'alergare',
  't-shirt': 'tricou', shirt: 'cămașă', shorts: 'pantaloni scurți', jeans: 'blugi', dress: 'rochie',
  jacket: 'geacă', coat: 'palton', hat: 'pălărie', cap: 'șapcă', shoe: 'pantof', sneakers: 'adidași',
  clothing: 'îmbrăcăminte', fashion: 'modă', sportswear: 'echipament sportiv', uniform: 'uniformă',
  baby: 'bebeluș', child: 'copil', toddler: 'copil mic', family: 'familie', friendship: 'prietenie',
  team: 'echipă', crowd: 'mulțime', group: 'grup', people: 'oameni', portrait: 'portret',
  // — anatomie/portret suplimentar
  forehead: 'frunte', chin: 'bărbie', cheek: 'obraz', nose: 'nas', eyebrow: 'sprânceană',
  eyelash: 'gene', jaw: 'maxilar', neck: 'gât', ear: 'ureche', lip: 'buze', tooth: 'dinte',
  'facial hair': 'barbă/mustață', mustache: 'mustață', 'long hair': 'păr lung',
  'blond hair': 'păr blond', 'black hair': 'păr negru', wrinkle: 'rid', headgear: 'acoperământ cap',
  sunglasses: 'ochelari de soare', earrings: 'cercei', necklace: 'colier', jewellery: 'bijuterii',
  ring: 'inel', bracelet: 'brățară', watch: 'ceas de mână', makeup: 'machiaj',
  // — imbracaminte suplimentar
  'formal wear': 'ținută elegantă', suit: 'costum', blazer: 'sacou', sweater: 'pulover',
  hoodie: 'hanorac', scarf: 'eșarfă', glove: 'mănușă', sock: 'șosetă', belt: 'curea',
  boot: 'cizmă', sandal: 'sandală', 'high heels': 'tocuri', swimwear: 'costum de baie',
  bikini: 'bikini', costume: 'costum tematic', 'wedding dress': 'rochie de mireasă',
  pajamas: 'pijama',
  // — activitati/pose
  jumping: 'săritură', dancing: 'dans', singing: 'cântat', laughing: 'râs', crying: 'plâns',
  kissing: 'sărut', hugging: 'îmbrățișare', waving: 'gest de salut', posing: 'pozat',
  sleeping: 'somn', eating: 'mâncat', drinking: 'băut', reading: 'citit', writing: 'scris',
  playing: 'joacă',

  // natura, peisaj, vreme
  water: 'apă', sky: 'cer', cloud: 'nor', sea: 'mare', ocean: 'ocean', lake: 'lac', river: 'râu',
  beach: 'plajă', sand: 'nisip', wave: 'val', sunset: 'apus', sunrise: 'răsărit',
  sunlight: 'lumina soarelui', horizon: 'orizont', nature: 'natură', landscape: 'peisaj',
  'natural landscape': 'peisaj natural', mountain: 'munte', hill: 'deal', forest: 'pădure',
  tree: 'copac', plant: 'plantă', flower: 'floare', 'flowering plant': 'plantă cu flori',
  grass: 'iarbă', leaf: 'frunză', branch: 'creangă', snow: 'zăpadă', winter: 'iarnă', ice: 'gheață',
  rain: 'ploaie', fog: 'ceață',
  // — natura extinsa
  waterfall: 'cascadă', canyon: 'canion', desert: 'deșert', valley: 'vale', cave: 'peșteră',
  cliff: 'stâncă', island: 'insulă', volcano: 'vulcan', glacier: 'ghețar', rainbow: 'curcubeu',
  lightning: 'fulger', storm: 'furtună', wind: 'vânt', dew: 'rouă', dust: 'praf',
  meadow: 'poiană', prairie: 'prerie', savanna: 'savană', jungle: 'junglă',
  wilderness: 'sălbăticie', garden: 'grădină', park: 'parc', path: 'potecă', trail: 'traseu',
  rock: 'stâncă', stone: 'piatră', pebble: 'pietricică', cactus: 'cactus', 'palm tree': 'palmier',
  pond: 'iaz', stream: 'pârâu', coast: 'coastă', shore: 'țărm', pier: 'chei', dock: 'doc',
  // — cer/vreme suplimentar
  dusk: 'amurg', dawn: 'zori', twilight: 'amurg', moon: 'lună', star: 'stea', galaxy: 'galaxie',
  aurora: 'auroră boreală', thunderstorm: 'furtună cu tunete', hail: 'grindină', drizzle: 'burniță',

  // orase, cladiri, vehicule
  building: 'clădire', house: 'casă', architecture: 'arhitectură', city: 'oraș',
  skyscraper: 'zgârie-nori', street: 'stradă', road: 'drum', sidewalk: 'trotuar', bridge: 'pod',
  room: 'cameră', 'interior design': 'design interior', furniture: 'mobilă', table: 'masă',
  sofa: 'canapea', kitchen: 'bucătărie', bathroom: 'baie', vehicle: 'vehicul', wheel: 'roată',
  bike: 'bicicletă', 'motor vehicle': 'autovehicul',
  // — cladiri/urban suplimentar
  apartment: 'apartament', cottage: 'cabană', cabin: 'cabană', castle: 'castel', tower: 'turn',
  monument: 'monument', statue: 'statuie', church: 'biserică', cathedral: 'catedrală',
  temple: 'templu', mosque: 'moschee', museum: 'muzeu', library: 'bibliotecă', school: 'școală',
  university: 'universitate', hospital: 'spital', hotel: 'hotel', office: 'birou',
  factory: 'fabrică', warehouse: 'depozit', market: 'piață', mall: 'mall', shop: 'magazin',
  store: 'magazin', stadium: 'stadion', arena: 'arenă', gym: 'sală de fitness', pool: 'piscină',
  'swimming pool': 'piscină', playground: 'loc de joacă', fence: 'gard', gate: 'poartă',
  staircase: 'scară', stairs: 'scări', balcony: 'balcon', terrace: 'terasă', courtyard: 'curte',
  fountain: 'fântână', sculpture: 'sculptură', mural: 'pictură murală', graffiti: 'graffiti',
  billboard: 'panou publicitar', lamp: 'lampă', 'street light': 'felinar', tunnel: 'tunel',
  railway: 'cale ferată', platform: 'peron', airport: 'aeroport', port: 'port',
  // — vehicule suplimentar
  sedan: 'berlină', convertible: 'decapotabilă', 'pickup truck': 'pick-up', van: 'dubă',
  trailer: 'remorcă', tractor: 'tractor', helicopter: 'elicopter', jet: 'avion cu reacție',
  glider: 'planor', 'hot air balloon': 'balon cu aer cald', yacht: 'iaht', canoe: 'canoe',
  kayak: 'caiac', sailboat: 'barcă cu pânze', ferry: 'feribot', 'cruise ship': 'vas de croazieră',
  submarine: 'submarin', scooter: 'trotinetă', moped: 'moped', wheelchair: 'scaun cu rotile',
  stroller: 'cărucior', tire: 'anvelopă', headlight: 'far', 'license plate': 'număr de înmatriculare',
  engine: 'motor',
  // — mobila/interior suplimentar
  cabinet: 'dulap', shelf: 'raft', drawer: 'sertar', mirror: 'oglindă', curtain: 'perdea',
  carpet: 'covor', rug: 'covor', pillow: 'pernă', cushion: 'pernă', blanket: 'pătură',
  chandelier: 'candelabru', fireplace: 'șemineu', wallpaper: 'tapet', tile: 'gresie',
  ceiling: 'tavan', floor: 'podea', doorway: 'cadru de ușă', 'home appliance': 'electrocasnic',
  fan: 'ventilator', heater: 'calorifer', 'air conditioning': 'aer condiționat',
  thermostat: 'termostat',

  // animale
  animal: 'animal', wildlife: 'animal sălbatic', pet: 'animal de companie', puppy: 'cățeluș',
  kitten: 'pisicuță', fish: 'pește', insect: 'insectă',
  // — animale extinse
  'dog breed': 'rasă de câine', 'cat breed': 'rasă de pisică', mammal: 'mamifer',
  vertebrate: 'vertebrat', carnivore: 'carnivor', rabbit: 'iepure', hamster: 'hamster',
  rodent: 'rozător', reptile: 'reptilă', snake: 'șarpe', lizard: 'șopârlă', turtle: 'țestoasă',
  frog: 'broască', butterfly: 'fluture', bee: 'albină', spider: 'păianjen', ant: 'furnică',
  dragonfly: 'libelulă', chicken: 'găină', duck: 'rață', goose: 'gâscă', owl: 'bufniță',
  eagle: 'vultur', parrot: 'papagal', penguin: 'pinguin', dolphin: 'delfin', whale: 'balenă',
  shark: 'rechin', lion: 'leu', tiger: 'tigru', monkey: 'maimuță', deer: 'cerb', fox: 'vulpe',
  wolf: 'lup', squirrel: 'veveriță', hedgehog: 'arici', snail: 'melc', jellyfish: 'meduză',
  camel: 'cămilă', pig: 'porc', goat: 'capră', donkey: 'măgar', llama: 'lamă',
  kangaroo: 'cangur', koala: 'koala', panda: 'panda',

  // mancare/bautura
  food: 'mâncare', meal: 'masă', dish: 'fel de mâncare', cuisine: 'bucătărie', dessert: 'deșert',
  fruit: 'fruct', vegetable: 'legume', drink: 'băutură', beverage: 'băutură', coffee: 'cafea',
  tea: 'ceai', wine: 'vin', restaurant: 'restaurant', cooking: 'gătit',
  // — mancare extinsa
  bread: 'pâine', cheese: 'brânză', meat: 'carne', beef: 'carne de vită', pork: 'carne de porc',
  seafood: 'fructe de mare', shrimp: 'creveți', lobster: 'homar', crab: 'crab', egg: 'ou',
  rice: 'orez', pasta: 'paste', noodle: 'tăiței', soup: 'supă', salad: 'salată', sauce: 'sos',
  spice: 'condiment', herb: 'ierburi aromatice', sugar: 'zahăr', salt: 'sare',
  chocolate: 'ciocolată', candy: 'bomboane', cookie: 'fursec', 'ice cream': 'înghețată',
  pancake: 'clătită', waffle: 'vafă', muffin: 'brioșă', croissant: 'croasant', bagel: 'covrig',
  taco: 'taco', burrito: 'burrito', sushi: 'sushi', dumpling: 'colțunași', curry: 'curry',
  barbecue: 'grătar', grill: 'grătar', picnic: 'picnic', buffet: 'bufet', 'fast food': 'fast-food',
  snack: 'gustare', beer: 'bere', cocktail: 'cocktail', juice: 'suc', soda: 'sifon',
  teapot: 'ceainic', kettle: 'fierbător', tablecloth: 'față de masă', napkin: 'șervețel',
  tray: 'tavă', plate: 'farfurie', platter: 'platou',

  // evenimente/obiecte
  event: 'eveniment', party: 'petrecere', wedding: 'nuntă', holiday: 'vacanță', christmas: 'Crăciun',
  birthday: 'zi de naștere', celebration: 'sărbătoare', festival: 'festival', ceremony: 'ceremonie',
  toy: 'jucărie', doll: 'păpușă', balloon: 'balon', gift: 'cadou',
  // — evenimente/obiecte suplimentar
  fireworks: 'artificii', candle: 'lumânare', ribbon: 'panglică', decoration: 'decorațiune',
  ornament: 'ornament', wreath: 'coroniță', banner: 'banner', flag: 'steag', trophy: 'trofeu',
  medal: 'medalie', certificate: 'certificat', invitation: 'invitație', envelope: 'plic',
  confetti: 'confetti', mask: 'mască', circus: 'circ', carnival: 'carnaval', parade: 'paradă',
  fair: 'târg',

  // sport, muzica, arta
  sport: 'sport', ball: 'minge', game: 'joc', football: 'fotbal', basketball: 'baschet',
  tennis: 'tenis', swimming: 'înot', fitness: 'fitness', 'musical instrument': 'instrument muzical',
  music: 'muzică', guitar: 'chitară', piano: 'pian', concert: 'concert', dance: 'dans', art: 'artă',
  painting: 'pictură', drawing: 'desen',
  // — sport extinse
  'ice hockey': 'hochei pe gheață', hockey: 'hochei', volleyball: 'volei', baseball: 'baseball',
  golf: 'golf', boxing: 'box', wrestling: 'lupte', cycling: 'ciclism', skiing: 'schi',
  snowboarding: 'snowboarding', surfing: 'surfing', skating: 'patinaj',
  'ice skating': 'patinaj pe gheață', climbing: 'cățărare', hiking: 'drumeție', camping: 'camping',
  fishing: 'pescuit', hunting: 'vânătoare', archery: 'tir cu arcul', gymnastics: 'gimnastică',
  athletics: 'atletism', marathon: 'maraton', race: 'cursă', competition: 'competiție',
  championship: 'campionat', tournament: 'turneu', coach: 'antrenor', referee: 'arbitru',
  athlete: 'atlet',
  // — muzica/arta suplimentar
  violin: 'vioară', drum: 'tobă', trumpet: 'trompetă', saxophone: 'saxofon',
  microphone: 'microfon', speaker: 'boxă', orchestra: 'orchestră', band: 'trupă', choir: 'cor',
  opera: 'operă', theater: 'teatru', ballet: 'balet', pottery: 'olărit', craft: 'artizanat',
  calligraphy: 'caligrafie', exhibition: 'expoziție', gallery: 'galerie',

  // tehnologie/text
  text: 'text', font: 'font', logo: 'logo', product: 'produs', electronics: 'electronice',
  'mobile phone': 'telefon mobil', smartphone: 'smartphone', computer: 'computer',
  screen: 'ecran', camera: 'aparat foto', technology: 'tehnologie',
  // — tehnologie suplimentar
  television: 'televizor', headphones: 'căști', earphones: 'căști in-ear', tablet: 'tabletă',
  printer: 'imprimantă', router: 'router', cable: 'cablu', charger: 'încărcător',
  battery: 'baterie', drone: 'dronă', robot: 'robot', satellite: 'satelit', antenna: 'antenă',
  monitor: 'monitor', projector: 'proiector', telescope: 'telescop', microscope: 'microscop',
  // — text/simboluri
  number: 'număr', letter: 'literă', symbol: 'simbol', icon: 'pictogramă', emblem: 'emblemă',
  badge: 'insignă', stamp: 'ștampilă', coin: 'monedă', currency: 'bani', map: 'hartă',
  chart: 'grafic', graph: 'grafic', diagram: 'diagramă', calendar: 'calendar',
  newspaper: 'ziar', magazine: 'revistă',
  // — materiale/texturi
  pattern: 'model', texture: 'textură', wood: 'lemn', metal: 'metal', glass: 'sticlă',
  plastic: 'plastic', fabric: 'material textil', textile: 'textil', leather: 'piele naturală',
  silk: 'mătase', cotton: 'bumbac', wool: 'lână', denim: 'denim', lace: 'dantelă',
  // — concepte/emotii
  love: 'dragoste', romance: 'romantism', adventure: 'aventură', freedom: 'libertate',
  meditation: 'meditație', yoga: 'yoga', wellness: 'wellness', health: 'sănătate',
  medicine: 'medicină', education: 'educație', learning: 'învățare', business: 'afaceri',
  work: 'muncă', meeting: 'întâlnire', conference: 'conferință', teamwork: 'lucru în echipă',
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
  // Materiale si suprafete lipsa din familia de mai sus. "paper" e cel care a
  // costat: comentariul din nativeAnalysis.ts sustinea ca e aici, nu era, si de
  // aceea un panou de pluta plin de bonuri trecea drept subiect concret ("hartie"),
  // OCR-ul nu mai rula, iar poza se aproba singura cu scor 98.
  'paper', 'cardboard', 'cork', 'stone', 'concrete', 'brick', 'plaster', 'tile',
  'ceramic', 'rubber', 'foam', 'wall', 'floor', 'ceiling', 'surface', 'material',
  'love', 'romance', 'adventure', 'freedom', 'meditation', 'yoga', 'wellness', 'health', 'medicine',
  'education', 'learning', 'business', 'work', 'meeting', 'conference', 'teamwork', 'success',
  'number', 'letter', 'symbol', 'icon', 'emblem', 'badge', 'stamp', 'coin', 'currency', 'map',
  'chart', 'graph', 'diagram', 'calendar', 'newspaper', 'magazine',
  'font', 'logo', 'product', 'electronics', 'technology', 'text'
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
