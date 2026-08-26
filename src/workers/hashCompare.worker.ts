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
import { bkInsert, bkQuery, type BKNode } from '../core/bkTree';

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
  /** Embedding-uri (1024-dim, FaceRes) ale fetelor detectate in poza — unul per fata, absent/gol daca nu s-a detectat nicio fata. */
  faceEmbeddings?: number[][];
  /**
   * Embedding general de similaritate vizuala (MediaPipe Image Embedder,
   * AnalysisRecord.imageEmbedding) — DOAR pentru poze fara fete (Android
   * nativ). "A doua opinie" pentru rafale fara oameni (peisaje, animale),
   * care altfel cad pe semnalul mai slab compozitie+armonie-culori de mai jos.
   */
  imageEmbedding?: number[];
  /** 0..1, vezi AnalysisRecord.colorHarmonyScore — folosit doar ca semnal secundar cand nu exista fete de comparat. */
  colorHarmonyScore?: number;
  /**
   * Cele mai frecvente 3 culori din cadru (hex, vezi AnalysisRecord.dominantColors)
   * — paleta reala a scenei, nu un scor agregat despre ea. Singurul semnal din
   * HashInput care descrie UNDE a fost facuta poza si care exista si cand poza
   * are fete; vezi sceneContradicts().
   */
  dominantColors?: string[];
  /** Momentul capturii (EXIF, altfel data fisierului) — vezi TIME_CLOSE_SIMILARITY_THRESHOLD. Absent = doar pragul strans de asemanare. */
  capturedAt?: number;
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
 * Ridicat de la 8 la 14 dupa feedback direct pe device real: mai multe serii
 * evidente (acelasi cadru/fundal, subiect uman in miscare intre poze — copil
 * alergand/schimband pozitia bratelor pe un echipament de joaca, poze cu
 * pisica) NU erau detectate deloc ("Serii: 0" desi vizibil existau).
 * dHash-ul (gradient de luminanta pe grila 9x8) e sensibil la cat de mult
 * din cadru ocupa un subiect care se misca intre cadre consecutive — poze
 * facute din mana, la cateva secunde distanta (nu rafala reala cu cadru
 * blocat) pot depasi usor un prag de 8/64 (~12%), desi sunt clar aceeasi
 * serie pentru orice om care se uita la ele. 14/64 (~22%) ramane sub praguri
 * mult mai permisive folosite in alte instrumente de deduplicare, iar
 * riscul de fals-pozitiv (compozitie similara, subiecti diferiti) e acoperit
 * in continuare de refineBucket() mai jos (fete/compozitie/armonie culori).
 */
const SIMILARITY_THRESHOLD = 14;

/**
 * Prag mai permisiv, folosit DOAR intre poze facute la cateva zeci de secunde
 * una de alta.
 *
 * Bug raportat cu captura: o serie evidenta (aceeasi mama tinand acelasi copil
 * in acelasi parc innezapezit, 6 cadre consecutive) nu a fost grupata deloc.
 * dHash-ul compara luminanta pe o grila 9x8, deci "acelasi moment, dar cu un
 * pas in lateral si un zoom putin diferit" muta mult din cadru si sare usor de
 * 14/64 — chiar daca pentru orice om sunt limpede aceeasi serie.
 *
 * Timpul e semnalul care lipsea: doua poze facute la 20 de secunde una de alta
 * SUNT, aproape mereu, acelasi moment. Nu e suficient singur (doua poze
 * diferite la o petrecere sunt tot la secunde distanta), de aceea ramane o
 * conditie IN PLUS peste asemanarea vizuala, doar cu pragul relaxat — iar
 * refineBucket() de mai jos verifica oricum, dupa, ca subiectul chiar e acelasi
 * (fete, embedding de continut).
 */
const TIME_CLOSE_SIMILARITY_THRESHOLD = 24;
/** Cat de aproape in timp trebuie sa fie doua poze ca sa merite pragul relaxat de mai sus. */
const BURST_WINDOW_MS = 45_000;

/**
 * Al treilea nivel: MOMENTE, nu rafale.
 *
 * O rafala inseamna secunde. Dar galeriile de telefon sunt pline de altceva:
 * acelasi subiect fotografiat de mai multe ori pe parcursul catorva minute — te
 * dai un pas in spate, incerci pe verticala, mai astepti o data ca omul sa se
 * uite la tine. Pentru cine sorteaza, alea sunt tot "aceeasi poza de mai multe
 * ori", dar cad mult peste pragul de rafala: si timpul, si cadrul s-au schimbat
 * prea mult.
 *
 * Aici, spre deosebire de celelalte doua nivele, asemanarea vizuala nu mai e
 * argumentul principal — e o preselectie, iar ce decide e sameSubjectConfirmed(),
 * care cere DOVADA (aceeasi fata, sau embedding de continut apropiat), nu simpla
 * absenta a unei contraziceri. Fara dovada, poza ramane negrupata, chiar daca
 * timpul si dHash-ul s-ar potrivi.
 *
 * COBORAT DE LA 30 LA 26 — bug raportat cu captura: un cadru cu fetita MERGAND
 * pe alee si doua cadre cu ea ASEZATA pe o banca, in fata bisericii, ajunsesera
 * in aceeasi serie, cu "Recomandat AI" pe cel care mergea. Alt loc, alta poza,
 * dar aplicatia cerea sa fie ales unul singur dintre ele.
 *
 * Cauza e aritmetica, nu de reglaj: hash-ul e un sir de 64 de biti, deci doua
 * imagini FARA NICIO LEGATURA au, in medie, distanta 32 — fiecare bit e practic
 * dat cu banul. Masurat pe 200.000 de perechi aleatoare, un prag de 30 lasa sa
 * treaca 35% dintre ele; preselectia "ieftina" nu selecta aproape nimic. Ce mai
 * ramanea din nivelul 3 era: aceeasi fata + 8 minute — iar intr-o sedinta cu un
 * singur copil, fata e o constanta, deci nu deosebeste nimic. De aici, o treime
 * din perechile nepotrivite din acele 8 minute intrau impreuna in serie.
 *
 * 26 lasa sa treaca 8,5% in loc de 35%, si pastreaza slabiciunea reala pentru
 * care exista nivelul 3 (te dai un pas in spate, incerci pe verticala). Restul e
 * acoperit de vetoul din sceneContradicts(): fata dovedeste CINE, nu UNDE.
 */
const MOMENT_SIMILARITY_THRESHOLD = 26;
/** Cat de lung poate fi un "moment". Peste asta e o alta scena, oricat de mult ar semana. */
const MOMENT_WINDOW_MS = 8 * 60_000;

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

/** O intrare din BK-tree: un cadru si seria din care face parte. */
interface Indexed {
  bucket: number;
  photo: HashInput;
}

/**
 * dHash e un semnal STRUCTURAL (gradient de luminanta pe o grila 9x8) — poze
 * cu compozitie/expunere similara dar SUBIECTI DIFERITI (ex. acelasi unghi de
 * cadru la o nunta, dar grupuri diferite de invitati) pot cadea, din pacate,
 * sub acelasi prag de distanta Hamming ca o rafala reala. Pragul ramane
 * MAI PERMISIV decat cel de la recunoastere/clustering (0.55/0.65 in
 * faceAnalysis.worker.ts / faceClustering.ts): aici comparam cadre deja
 * confirmate ca structural similare de dHash, deci fetele ACELUIASI subiect
 * ar trebui sa semene puternic — un prag mai jos ar rata prea multe potriviri
 * reale (unghi/expresie usor diferite intre cadre consecutive).
 */
const FACE_MATCH_THRESHOLD = 0.5;
/**
 * Prag de similaritate cosinus pentru embedding-ul general (MediaPipe Image
 * Embedder + MobileNetV3-small) — semnal folosit DOAR cand nu exista fete de
 * comparat (vezi looksLikeSameSubject). Mai permisiv decat FACE_MATCH_THRESHOLD
 * din acelasi motiv structural (comparam cadre deja confirmate similare de
 * dHash), dar NEVERIFICAT pe un set mare de poze reale — un embedding general
 * de continut (nu specializat pe identitate ca FaceRes) tinde sa clusterizeze
 * mai lejer, deci pragul e un prim ghicit rezonabil, de recalibrat daca la
 * testare pe device desparte gresit rafale reale fara oameni.
 */
const IMAGE_EMBEDDING_MATCH_THRESHOLD = 0.75;
/** Delta compozitie/armonie culori peste care doua poze par scene diferite — folosit DOAR cand nu exista fete SI nu exista embedding general de comparat. */
const COMPOSITION_DELTA_THRESHOLD = 0.4;
const COLOR_HARMONY_DELTA_THRESHOLD = 0.35;
/** Peste acest numar de membri intr-un bucket, sarim rafinarea O(n^2) — bucket-e dHash normale raman mult sub prag. */
const MAX_REFINEMENT_BUCKET_SIZE = 200;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** true daca cele doua cadre sunt la cel mult `windowMs` unul de altul. Fara data de captura pe vreuna dintre parti, nu putem afirma nimic. */
function closeInTimeTo(photo: HashInput, other: HashInput, windowMs: number): boolean {
  if (photo.capturedAt === undefined || other.capturedAt === undefined) return false;
  return Math.abs(other.capturedAt - photo.capturedAt) <= windowMs;
}

function bestFaceSimilarity(a: number[][], b: number[][]): number | null {
  if (!a.length || !b.length) return null;
  let best = -1;
  for (const ea of a) for (const eb of b) best = Math.max(best, cosineSimilarity(ea, eb));
  return best;
}

/**
 * Decide daca doua poze DEJA in acelasi bucket dHash par sa arate acelasi
 * subiect/scena. Fetele sunt semnalul decisiv cand exista pe ambele parti;
 * fara fete (peisaje, spate intors), incearca embedding-ul general de
 * continut (imageEmbedding, Android nativ) — o "a doua opinie" mai puternica
 * decat compozitie+armonie culori pentru rafale fara oameni; daca niciunul nu
 * exista (web/PWA, sau inregistrari mai vechi), recurge la compozitie+armonie
 * culori — dar cere ca AMBELE sa diverga semnificativ, ca un singur semnal
 * zgomotos sa nu desparta gresit cadre reale din aceeasi serie. Fara niciun
 * semnal utilizabil, ramane compatibila (comportamentul original, doar-dHash).
 */
/**
 * Una are oameni in ea, cealalta nu.
 *
 * Bug real raportat cu captura: o poza cu o foaie de hartie scrisa si o poza cu
 * un copil si o pisica ajunsesera in ACEEASI serie. Cauza nu era pragul de
 * hash, ci o gaura in logica de mai jos: `bestFaceSimilarity` intoarce `null`
 * cand VREUNA dintre parti n-are fete, deci semnalul decisiv se sarea cu totul;
 * iar embedding-ul general se calculeaza (pe Android) DOAR pentru pozele fara
 * fete, deci nici el nu exista pe ambele parti. Ramanea ultima ramura, care
 * spunea "nu se bat cap in cap, deci le las impreuna" — un `return true` pe
 * lipsa de informatie.
 *
 * Prezenta oamenilor E informatie. Doua cadre din aceeasi serie nu se pot
 * deosebi prin "in unul e o persoana, in celalalt niciuna" decat prin accident
 * de detectie, si atunci raman apropiate in timp si aproape identice vizual —
 * caz in care raspunde regula stransa de sus, nu aceasta.
 */
function facePresenceDiffers(a: HashInput, b: HashInput): boolean {
  const aHas = (a.faceEmbeddings?.length ?? 0) > 0 || (a.faceCount ?? 0) > 0;
  const bHas = (b.faceEmbeddings?.length ?? 0) > 0 || (b.faceCount ?? 0) > 0;
  return aHas !== bHas;
}

function looksLikeSameSubject(a: HashInput, b: HashInput): boolean {
  const faceSim = bestFaceSimilarity(a.faceEmbeddings ?? [], b.faceEmbeddings ?? []);
  if (faceSim !== null) return faceSim >= FACE_MATCH_THRESHOLD;

  if (a.imageEmbedding && b.imageEmbedding) {
    return cosineSimilarity(a.imageEmbedding, b.imageEmbedding) >= IMAGE_EMBEDDING_MATCH_THRESHOLD;
  }

  if (a.compositionScore != null && b.compositionScore != null && a.colorHarmonyScore != null && b.colorHarmonyScore != null) {
    const compositionDelta = Math.abs(a.compositionScore - b.compositionScore);
    const colorDelta = Math.abs(a.colorHarmonyScore - b.colorHarmonyScore);
    // Cand una are oameni si cealalta nu, un singur semnal divergent ajunge ca
    // sa le desparta; cand amandoua sunt de acelasi fel, ramane regula veche
    // (cer AMBELE divergente), ca un semnal zgomotos sa nu rupa o serie reala.
    return facePresenceDiffers(a, b)
      ? !(compositionDelta > COMPOSITION_DELTA_THRESHOLD || colorDelta > COLOR_HARMONY_DELTA_THRESHOLD)
      : !(compositionDelta > COMPOSITION_DELTA_THRESHOLD && colorDelta > COLOR_HARMONY_DELTA_THRESHOLD);
  }
  // Fara niciun semnal comparabil: daca una are oameni si cealalta nu, raspunsul
  // e "nu", nu "presupunem ca da".
  return !facePresenceDiffers(a, b);
}

/**
 * Ca `looksLikeSameSubject`, dar cere DOVADA ca e acelasi subiect, nu doar
 * absenta unei contraziceri.
 *
 * Diferenta e intreaga garantie a nivelului "moment": acolo pragul vizual e
 * larg si fereastra de timp e de minute, deci un `return true` pe lipsa de date
 * (cum face varianta permisiva la final) ar grupa scene complet diferite dintr-o
 * petrecere. Aici, lipsa semnalului inseamna "nu", nu "presupunem ca da" — si nu
 * accepta niciodata semnalul slab compozitie+armonie-culori, care spune doar ca
 * doua poze nu se bat cap in cap, nu ca arata acelasi lucru.
 */
function sameSubjectConfirmed(a: HashInput, b: HashInput): boolean {
  const faceSim = bestFaceSimilarity(a.faceEmbeddings ?? [], b.faceEmbeddings ?? []);
  if (faceSim !== null) return faceSim >= FACE_MATCH_THRESHOLD;
  if (a.imageEmbedding && b.imageEmbedding) {
    return cosineSimilarity(a.imageEmbedding, b.imageEmbedding) >= IMAGE_EMBEDDING_MATCH_THRESHOLD;
  }
  return false;
}

/** Distanta euclidiana intre doua culori hex, normalizata la 0..1. */
function hexDistance(a: string, b: string): number | null {
  const parse = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return null;
  const dr = ca[0] - cb[0], dg = ca[1] - cb[1], db = ca[2] - cb[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3 * 255 * 255);
}

/**
 * Cat de departe e paleta unei poze de a celeilalte: pentru fiecare culoare
 * dominanta din `a`, distanta pana la cea mai apropiata din `b`, apoi MEDIA
 * acelor potriviri. Simetrizat, ca ordinea sa nu conteze.
 *
 * Media, nu maximul: intrebarea e "s-a schimbat locul?", iar la o schimbare de
 * loc se mutà toata paleta. Maximul raspunde la altceva — "exista o culoare
 * fara pereche?" — si se declanseaza si cand cineva imbracat in rosu intra
 * intr-un cadru altfel neschimbat.
 *
 * `null` cand vreuna dintre parti n-are paleta (inregistrari mai vechi, sau
 * cadru fara nicio culoare saturata) — vezi sceneContradicts pentru ce se
 * intampla atunci.
 */
function paletteDistance(a: string[], b: string[]): number | null {
  if (!a.length || !b.length) return null;
  const meanNearest = (from: string[], to: string[]): number | null => {
    let sum = 0;
    for (const c of from) {
      let nearest = Infinity;
      for (const d of to) {
        const dist = hexDistance(c, d);
        if (dist !== null) nearest = Math.min(nearest, dist);
      }
      if (nearest === Infinity) return null;
      sum += nearest;
    }
    return sum / from.length;
  };
  const ab = meanNearest(a, b), ba = meanNearest(b, a);
  if (ab === null || ba === null) return null;
  return Math.max(ab, ba);
}

/**
 * Peste atat, cele doua palete descriu locuri diferite.
 *
 * Calibrat pe cazul raportat (alee cu iarba vs. banca rosie langa un zid alb:
 * 0,20) fata de doua cadre din acelasi loc (0,02) — o separare de aproape zece
 * ori, deci pragul n-are nevoie sa fie fin. Asezat intentionat spre capatul
 * permisiv al intervalului: asta e un VETO de rezerva, nu reparatia principala
 * (aia e pragul coborat la 26), si o serie reala nu trebuie sa se rupa pentru ca
 * subiectul s-a miscat si a intrat mai mult cer in cadru.
 */
const SCENE_PALETTE_DELTA = 0.18;

/**
 * "Dovada ca NU e acelasi loc", folosita doar la nivelul 3.
 *
 * De ce e nevoie de ea: la nivelul 3, dovada de subiect vine aproape mereu din
 * fete, iar o fata raspunde la intrebarea CINE, nu UNDE. Cine isi fotografiaza
 * copilul in parc are acelasi chip in absolut fiecare cadru din sedinta —
 * semnalul e o constanta, deci nu deosebeste doua momente diferite. Paleta
 * cadrului e singurul lucru din HashInput care descrie scena si care exista si
 * cand poza are oameni in ea.
 *
 * Scris ca veto, nu ca cerinta: intoarce true doar cand semnalele CONTRAZIC,
 * niciodata cand lipsesc. Asa, o poza mai veche fara paleta salvata se comporta
 * exact ca inainte, si nicio serie reala nu se rupe din lipsa de date.
 */
function sceneContradicts(a: HashInput, b: HashInput): boolean {
  const paletteDelta = paletteDistance(a.dominantColors ?? [], b.dominantColors ?? []);
  if (paletteDelta !== null && paletteDelta > SCENE_PALETTE_DELTA) return true;

  // Fara paleta, ramane semnalul mai slab de dinainte: doua scoruri agregate
  // care trebuie sa diverga AMANDOUA ca sa insemne ceva.
  if (a.compositionScore != null && b.compositionScore != null
      && a.colorHarmonyScore != null && b.colorHarmonyScore != null) {
    return Math.abs(a.compositionScore - b.compositionScore) > COMPOSITION_DELTA_THRESHOLD
      && Math.abs(a.colorHarmonyScore - b.colorHarmonyScore) > COLOR_HARMONY_DELTA_THRESHOLD;
  }
  return false;
}

/**
 * Imparte un bucket dHash in componente conexe dupa `looksLikeSameSubject`
 * (Union-Find). Fiecare componenta ramane un grup real separat — NU doar cea
 * mai mare: pastrarea doar a celei mai mari si abandonarea restului ca
 * "negrupati" insemna ca, la un bucket care se imparte in doua rafale
 * distincte (ex. o rafala cu expresii destul de diferite incat similaritatea
 * fetei sa oscileze sub prag intre unele perechi), a doua rafala ramanea
 * complet nesupravegheata — fiecare cadru al ei aprobat independent, fara
 * nicio comparatie/demovare (bug real raportat: 5 cadre aproape identice
 * dintr-o rafala, toate aprobate automat).
 */
function refineBucket(members: HashInput[]): HashInput[][] {
  if (members.length < 2 || members.length > MAX_REFINEMENT_BUCKET_SIZE) return [members];

  const parent = members.map((_, i) => i);
  function find(i: number): number { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i: number, j: number) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (looksLikeSameSubject(members[i], members[j])) union(i, j);
    }
  }

  const componentsByRoot = new Map<number, HashInput[]>();
  members.forEach((m, i) => {
    const root = find(i);
    const list = componentsByRoot.get(root);
    if (list) list.push(m); else componentsByRoot.set(root, [m]);
  });

  if (componentsByRoot.size <= 1) return [members]; // niciun mismatch gasit — comportament neschimbat
  return [...componentsByRoot.values()];
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
    onUpdate?: (update: GroupUpdate) => void,
    /** Cat de mult sa cantareasca scorul invatat la alegerea celui mai bun cadru — vezi ContextEngine.learnedWeight(). 0 = doar ierarhia fixa, ca inainte. */
    learnedWeight = 0
  ): Promise<{ groups: GroupResult[]; totalGroups: number }> {
    const buckets: Bucket[] = [];
    // Indexul tine FIECARE cadru, nu doar seed-ul seriei (BK-tree, distanta
    // Hamming) — plan 2.3.3 ("algoritmi optimizati... LSH"): exact, nu
    // aproximativ ca LSH clasic. Vezi comentariul lung de la `matches` mai jos
    // pentru de ce s-a schimbat din seed in toti membrii.
    let memberTree: BKNode<Indexed> | null = null;

    for (let start = 0; start < photos.length; start += CHUNK_SIZE) {
      const chunk = photos.slice(start, start + CHUNK_SIZE);
      for (const photo of chunk) {
        // Toate cele trei reguli se aplica fata de cadrul VECIN gasit in index,
        // nu fata de prima poza a seriei.
        //
        // BUG RAPORTAT CU CAPTURA: cinci cadre ale aceluiasi colt de camera,
        // la cateva secunde unul de altul, au primit TREI bife verzi. Nu
        // scorurile erau gresite (94..97, toate corecte pentru cat de bine e
        // facut cadrul) — seria s-a rupt in bucati, iar demovarea din
        // importPipeline lasa cate o bifa in fiecare bucata.
        //
        // Cauza e derivă. Comparatia se facea DOAR cu seed-ul, adica prima
        // poza care a creat seria. Intr-o rafala cadrul se muta putin de
        // fiecare data; vecinii raman la 8-10 biti unul de altul, dar capatul
        // ajunge la 30+ fata de inceput. Cadrul 5 nu mai semana cu cadrul 1,
        // desi semana perfect cu cadrul 4 — si nici macar nu era intrebat
        // despre cadrul 4, fiindca indexul continea doar seed-uri.
        //
        // Acum fiecare cadru intra in index cu bucket-ul lui, deci interogarea
        // gaseste seria prin ORICARE membru. Legatura ramane la fel de stricta
        // ca inainte, doar ca se masoara intre vecini: fiecare veriga cere in
        // continuare <= 14 biti, sau <= 24 SI sub un minut, sau dovada de
        // acelasi subiect. O serie continua se leaga; doua scene diferite tot
        // n-au cum, fiindca n-au nicio veriga intre ele.
        const matches = bkQuery(memberTree, photo.hash, MOMENT_SIMILARITY_THRESHOLD, hammingDistance);
        const acceptate = new Set<number>();
        for (const m of matches) {
          if (acceptate.has(m.bucket)) continue; // bucket-ul e deja luat, nu-l re-evaluam
          const distance = hammingDistance(photo.hash, m.photo.hash);
          // 1. asemanare vizuala stransa — acceptata mereu, indiferent de timp
          if (distance <= SIMILARITY_THRESHOLD) { acceptate.add(m.bucket); continue; }
          // 2. rafala: prag relaxat, dar doar la cateva zeci de secunde distanta
          if (distance <= TIME_CLOSE_SIMILARITY_THRESHOLD && closeInTimeTo(photo, m.photo, BURST_WINDOW_MS)) {
            acceptate.add(m.bucket); continue;
          }
          // 3. moment: prag larg si minute intregi, DAR numai cu dovada ca e
          //    acelasi subiect SI fara vreo dovada ca e alt loc — o fata
          //    spune CINE, nu UNDE. Vezi MOMENT_SIMILARITY_THRESHOLD.
          if (closeInTimeTo(photo, m.photo, MOMENT_WINDOW_MS)
            && sameSubjectConfirmed(photo, m.photo) && !sceneContradicts(photo, m.photo)) {
            acceptate.add(m.bucket);
          }
        }
        // primul bucket creat dintre candidati — aceeasi regula de departajare ca
        // Array.prototype.find de dinainte (scanare in ordinea crearii)
        const bucketIndex = acceptate.size ? Math.min(...acceptate) : -1;
        if (bucketIndex !== -1) {
          buckets[bucketIndex].members.push(photo);
          memberTree = bkInsert(memberTree, photo.hash, { bucket: bucketIndex, photo }, hammingDistance);
        } else {
          const newIndex = buckets.length;
          buckets.push({ seedHash: photo.hash, members: [photo] });
          memberTree = bkInsert(memberTree, photo.hash, { bucket: newIndex, photo }, hammingDistance);
        }
      }
      // elibereaza firul (al worker-ului) intre chunk-uri — pe un fir dedicat
      // asta nu conteaza pentru main thread-ul aplicatiei (deja neblocat prin
      // simplul fapt ca ruleaza intr-un Worker), dar pastreaza worker-ul
      // insusi receptiv la alte mesaje intre loturi, exact cum a cerut specificatia.
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const groups: GroupResult[] = [];
    for (const bucket of buckets) {
      const components = refineBucket(bucket.members);
      for (const members of components) {
        if (members.length < 2) continue; // fara grup pentru poze unice (inclusiv dupa rafinare)
        const groupId = 'g-' + members[0].id.slice(0, 8);
        const bestId = pickBestInGroup(members.map(m => ({
          id: m.id,
          // `score` E aiScore-ul calculat la import (vezi HashInput) — pana acum
          // pastrat doar pentru afisare, acum si consultat la alegerea cadrului.
          aiScore: m.score,
          sharpness: m.sharpness ?? 0,
          exposure: m.exposure ?? 50,
          compositionScore: m.compositionScore,
          faceCount: m.faceCount ?? 0,
          bestSmile: m.bestSmile ?? 0,
          groupSmileRatio: m.groupSmileRatio,
          allEyesOpen: m.allEyesOpen ?? true,
          groupEyesOpenRatio: m.groupEyesOpenRatio,
          groupAwkwardRatio: m.groupAwkwardRatio,
          subjectInFocus: m.subjectInFocus,
          highlightClipping: m.highlightClipping,
          avgEyeContact: m.avgEyeContact
        })), learnedWeight);
        for (const m of members) onUpdate?.({ photoId: m.id, groupId });
        groups.push({ groupId, memberIds: members.map(m => m.id), bestId });
      }
    }

    return { groups, totalGroups: groups.length };
  }
}

export type HashCompareAPI = HashCompareService;

Comlink.expose(new HashCompareService());
