/**
 * core/smartInbox.ts
 *
 * Ce nu e amintire: capturi de ecran, documente, bilete, facturi.
 *
 * Intr-o galerie reala, o buna parte din cadre nu sunt fotografii — sunt
 * capturi de ecran, poze la o factura, la un bilet, la un formular. Ele intra
 * in aceeasi coada de triaj si cer aceeasi decizie cadru cu cadru ca o poza cu
 * copilul, desi nimeni nu vrea sa judece o captura de ecran dupa claritate si
 * regula treimilor. Rezultatul e o coada mai lunga si mai obositoare decat
 * trebuie.
 *
 * Modulul le separa. NU sterge nimic si nu decide nimic: doar spune "astea nu
 * par amintiri", ca sa poata fi scoase din drum sau tratate deodata. Stergerea
 * automata a unei capturi de ecran ar fi exact genul de gest care distruge
 * increderea — uneori captura ALA e lucrul important.
 *
 * SEMNALELE, in ordinea increderii:
 *   1. Numele fisierului. `Screenshot_2026-08-19...` e pus de sistemul de
 *      operare, nu de un model — e cel mai sigur semnal si costa zero.
 *   2. Text pe suprafata mare (`textCoverage`, din OCR-ul nativ) fara nicio
 *      fata. Un document e text; o poza cu oameni nu e.
 *   3. Proportia cadrului identica cu a ecranului, fara fete si fara etichete
 *      de obiect. Slab singur, folosit doar ca sa confirme.
 *
 * Nu se calculeaza nimic nou: toate semnalele exista deja dupa analiza.
 */

export type InboxCategory = 'screenshot' | 'document' | 'object' | 'personal';

export interface InboxCandidate {
  id: string;
  fileName: string;
  faceCount: number;
  /** Fractiune din cadru acoperita de text OCR (0..1). Doar pe Android nativ; absent in web. */
  textCoverage?: number;
  /** Etichete de obiect/scena (COCO-80). O poza cu obiecte recunoscute e aproape sigur o poza. */
  sceneTags?: string[];
  width?: number;
  height?: number;
}

/**
 * Tipare de nume puse de sistemul de operare sau de aplicatii, pe telefoanele
 * uzuale. Potrivire pe INCEPUTUL numelui, nu oriunde: o poza numita
 * "eu si screenshotul.jpg" nu e o captura de ecran.
 */
const SCREENSHOT_PREFIXES = ['screenshot', 'screen_shot', 'screnshot', 'captura', 'capture_', 'scrn'];
const SCREEN_RECORDING_PREFIXES = ['screenrecord', 'screen_record'];

/** Peste atat din cadru acoperit de text, si fara nicio fata, e un document. */
export const DOCUMENT_TEXT_COVERAGE = 0.12;

/**
 * Etichete care descriu un LUCRU FABRICAT, nu un moment.
 *
 * Bug raportat cu captura: poze la cutia unei lampi LED si la cutia unei
 * telecomenzi ajunsesera in banda "COMPARA ATENT", adica aplicatia cerea sa fie
 * comparate cu alternativele lor, ca doua cadre dintr-o sedinta.
 *
 * Cauza era ramura de mai jos care salveaza documentele fals-pozitive: "daca
 * modelul a vazut un caine sau un tort, e o poza cu text in ea, nu o pagina".
 * Buna intentie, dar o cutie de produs CHIAR are etichete de obiect — si e
 * acoperita de text tocmai pentru ca e un ambalaj. Salvarea se declansa exact
 * pe cazul pe care trebuia sa-l prinda.
 *
 * Deci nu orice eticheta de obiect inseamna "amintire". Astea de aici inseamna
 * "cineva a fotografiat un lucru": ambalaj, aparat, hartie, ecran. Sunt in
 * engleza fiindca asa vin din ML Kit / COCO.
 */
const MANUFACTURED_TAGS = new Set([
  // ambalaj si eticheta
  'box', 'carton', 'packaging', 'package', 'label', 'barcode', 'product',
  'brand', 'logo', 'font', 'price tag', 'wrapper', 'tin',
  // hartie scrisa
  'book', 'paper', 'document', 'text', 'poster', 'sign', 'receipt', 'ticket',
  'invoice', 'bill', 'menu', 'newspaper', 'magazine', 'business card',
  'envelope', 'note', 'notebook', 'form', 'certificate', 'diploma', 'manual',
  'banner', 'billboard', 'whiteboard', 'blackboard', 'chalkboard',
  'bulletin board', 'corkboard', 'poster board',
  // aparate
  'electronics', 'remote control', 'remote', 'appliance', 'device', 'gadget',
  'laptop', 'computer', 'keyboard', 'monitor', 'television', 'screen',
  'printer', 'router', 'charger', 'cable', 'battery', 'calculator',
  'mobile phone', 'smartphone', 'telephone', 'tablet', 'headphones', 'speaker',
  // recipiente
  'bottle', 'can', 'container', 'jar', 'packaging tape'
]);

/**
 * Peste atat din cadru acoperit de text, alaturi de etichete de lucru fabricat,
 * e o poza facuta ca sa RETINA ceva (un ambalaj, un manual, un cod), nu ca sa
 * pastreze un moment. Mai jos decat pragul de document, fiindca aici nu ne mai
 * bazam pe text singur: are si etichetele langa el.
 */
const OBJECT_TEXT_COVERAGE = 0.05;

/** Cat din etichete trebuie sa descrie un lucru fabricat ca sa nu mai fie amintire. */
const OBJECT_TAG_FRACTION = 0.5;

/**
 * Etichetele descriu, in majoritate, un lucru fabricat.
 *
 * Exportata pentru core/importPipeline.ts: acelasi semnal decide si daca o poza
 * are voie sa fie APROBATA automat, nu doar in ce grup din "Nu par amintiri"
 * intra. Un singur loc care stie ce inseamna "lucru fabricat".
 */
export function looksManufactured(tags: string[] | undefined): boolean {
  if (!tags?.length) return false;
  const hits = tags.filter(t => MANUFACTURED_TAGS.has(t.trim().toLowerCase())).length;
  return hits / tags.length >= OBJECT_TAG_FRACTION;
}
/** Peste atat, e text cat pe o captura de ecran chiar daca numele nu spune nimic. */
export const SCREENSHOT_TEXT_COVERAGE = 0.3;

function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  return fileName.slice(slash + 1).trim().toLowerCase();
}

function looksLikeScreenshotName(fileName: string): boolean {
  const n = baseName(fileName);
  return [...SCREENSHOT_PREFIXES, ...SCREEN_RECORDING_PREFIXES].some(p => n.startsWith(p));
}

/**
 * Proportia cadrului seamana cu a unui ecran de telefon (foarte inalt sau
 * foarte lat). Semnal SLAB — multe poze verticale au aceeasi proportie — deci
 * nu clasifica singur nimic, doar intareste celelalte semnale.
 */
function screenLikeAspect(width?: number, height?: number): boolean {
  if (!width || !height) return false;
  const ratio = Math.max(width, height) / Math.min(width, height);
  return ratio >= 1.7 && ratio <= 2.4;
}

export function classifyPhoto(p: InboxCandidate): InboxCategory {
  // 1. Numele fisierului — pus de sistem, cel mai sigur semnal.
  if (looksLikeScreenshotName(p.fileName)) return 'screenshot';

  // O fata inseamna aproape mereu o poza cu oameni. Nici text mult nu schimba
  // asta: o poza cu cineva in fata unui panou ramane o poza cu cineva.
  if (p.faceCount > 0) return 'personal';

  const text = p.textCoverage ?? 0;
  if (text >= SCREENSHOT_TEXT_COVERAGE && screenLikeAspect(p.width, p.height)) return 'screenshot';

  if (text >= DOCUMENT_TEXT_COVERAGE) {
    // Etichetele de obiect contrazic ipoteza de document: daca modelul a vazut
    // un caine sau un tort, e o poza cu text in ea, nu o pagina. Dar numai daca
    // sunt etichete de lucruri VII sau de scena — un ambalaj plin de text nu
    // devine amintire pentru ca modelul i-a zis "cutie".
    if (p.sceneTags?.length && !looksManufactured(p.sceneTags)) return 'personal';
    if (looksManufactured(p.sceneTags)) return 'object';
    return 'document';
  }

  // Sub pragul de document, dar cu ceva text SI cu etichete de lucru fabricat:
  // poza facuta ca sa retii ceva, nu ca sa pastrezi un moment.
  if (text >= OBJECT_TEXT_COVERAGE && looksManufactured(p.sceneTags)) return 'object';

  return 'personal';
}

export interface InboxGroup {
  category: Exclude<InboxCategory, 'personal'>;
  ids: string[];
}

/**
 * Grupeaza ce nu pare amintire. Categoria `personal` nu se intoarce: nu e ceva
 * de rezolvat, e restul bibliotecii.
 */
export function buildSmartInbox(photos: InboxCandidate[]): InboxGroup[] {
  const screenshot: string[] = [];
  const document: string[] = [];
  const object: string[] = [];
  for (const p of photos) {
    const c = classifyPhoto(p);
    if (c === 'screenshot') screenshot.push(p.id);
    else if (c === 'document') document.push(p.id);
    else if (c === 'object') object.push(p.id);
  }
  const out: InboxGroup[] = [];
  if (screenshot.length) out.push({ category: 'screenshot', ids: screenshot });
  if (document.length) out.push({ category: 'document', ids: document });
  if (object.length) out.push({ category: 'object', ids: object });
  return out;
}

/** Cate cadre nu par amintiri. Pentru insigne, fara sa construim grupurile. */
export function countNonPersonal(photos: InboxCandidate[]): number {
  let n = 0;
  for (const p of photos) if (classifyPhoto(p) !== 'personal') n++;
  return n;
}
