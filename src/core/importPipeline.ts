/**
 * core/importPipeline.ts
 * Import: decodare la 2048px -> preview + miniatura + dHash -> analiza ML (worker)
 * -> scor ContextEngine -> persistare IndexedDB -> grupare serii (persistata).
 * Preview-ul de 2048px (standard Lightroom) este cel pe care se judeca claritatea.
 */
import { decodeHeicToJpegBlob, isHeicDecodingSupported } from './nativeHeicDecoder';
import { db, type AnalysisRecord, type PhotoRecord } from './db';
import { analysisPool, withTimeout } from './workerPool';
import { contextEngine, landscapeSharpness, type Prediction } from './learning/ContextEngine';
import { rescueBestOfMoment } from './momentRescue';
import { groupPhotosByHash } from './hashComparePool';
import type { HashInput } from '../workers/hashCompare.worker';
import { parseExif } from './exifParser';
import { timed, timedSync, record } from './stageTiming';
import { parseIptc } from './iptcParser';
import { looksManufactured } from './smartInbox';
import { isRawFile, decodeRawFile, RAW_EXTENSIONS } from './rawDecoder';
import type { FileSystemFileHandleLike } from './filePicker';
import { pickFolderSceneTag } from './sceneTagLabels';
import { detectFacesNative, isNativeFaceDetectionAvailable } from './nativeFaceDetection';
import type { MediaLocation } from './nativeMediaLibrary';
import { hasRealGps } from './gpsCoordinates';
import { deriveThresholds, FIXED_THRESHOLDS, type Thresholds, applyStrictness } from './scoreThresholds';
import { readCullingStrictness } from '../state/cullingStrictness';
import { quickDuplicateScan, type QuickScanResult } from './quickDuplicateScan';

export interface ImportProgress {
  done: number;
  total: number;
  fileName: string;
  /** 'citire' = se aduc pozele din galerie, INAINTE de import (vezi nativeMediaLibrary.toFiles). */
  phase: 'citire' | 'incarcare' | 'pregatire' | 'analiza' | 'grupare' | 'finalizat';
  /** setat doar pe ultimul apel, daca importul s-a oprit inainte de a termina toate fisierele */
  warning?: string;
  /**
   * Pragurile de decizie folosite pentru ACEST lot — raportate o singura data,
   * la inceput, pe acelasi canal ca `warning`. Utilizatorul trebuie sa poata
   * afla de ce s-au propus brusc mai multe sau mai putine poze decat se astepta;
   * fara asta, plasa de siguranta din core/scoreThresholds.ts ar fi o schimbare
   * de comportament complet invizibila.
   */
  thresholds?: Thresholds;
  /**
   * Bilantul in cifre al lotului, raportat o singura data, pe ultimul apel.
   *
   * Exista separat de `warning` pentru ca mesajul e o propozitie pentru om, iar
   * asta e ceva ce se poate pastra si insuma peste mai multe importuri (vezi
   * core/importOutcome.ts). Fara el, singurul loc in care traia numarul de
   * esecuri era un toast de cateva secunde.
   */
  outcome?: ImportOutcomeReport;
  /**
   * Copiile identice gasite INAINTE de analiza, fara sa se decodeze nicio
   * imagine — vezi core/quickDuplicateScan.ts. Raportat de indata ce e gata,
   * ca utilizatorul sa aiba o cifra concreta cat timp analiza abia porneste.
   */
  quickScan?: QuickScanResult;
}

/** Numai cifre si motivul deja agregat — fara nume de fisier, fara cai. */
export interface ImportOutcomeReport {
  /** Fisiere intrate efectiv in analiza (dupa filtrarea formatelor nesuportate). */
  total: number;
  imported: number;
  failed: number;
  /** Alese, dar sarite inainte de analiza: video, HEIC, formate nesuportate. */
  skipped: number;
  /** Primele motive de esec, deja agregate. */
  reasons?: string;
}

export interface ImportedPhoto {
  photo: PhotoRecord;
  analysis: AnalysisRecord;
  prediction: Prediction;
}

const PREVIEW_MAX_SIDE = 2048;
const THUMB_SIZE = 512;
/** Placeholder blurat (LQIP) — latura cea mai lunga in pixeli reali; suficient de mic (cateva
    sute de octeti ca data: URI) ca sa fie stocat direct pe PhotoRecord, dar destul de detaliat
    cat sa se recunoasca formele/culorile dominante prin blur, nu doar un gradient generic. */
const LQIP_SIZE = 24;
/** Exportate (nu doar folosite local) — reutilizate de store.ts (rescorePhotos) ca sa clasifice
    exact la fel poze deja existente, re-scorate cu un model ContextEngine actualizat.
    Definitia traieste in core/scoreThresholds.ts, impreuna cu plasa de siguranta
    care le muta cand ar produce un rezultat degenerat (zero poze propuse, sau
    aproape toate). */
export { SELECT_THRESHOLD, REJECT_THRESHOLD } from './scoreThresholds';

/**
 * Un scor ContextEngine mare NU garanteaza ca AI-ul a recunoscut CEVA anume
 * in cadru — scorarea de claritate/expunere/compozitie functioneaza la fel
 * de bine (uneori chiar mai bine, fiind foarte "curate" optic) pe o poza a
 * unui document sau pe un detaliu de acoperis/perete fara niciun subiect
 * real, ca pe o poza buna. Fara nicio fata SI fara niciun obiect COCO
 * detectat (sceneTags), un scor peste prag NU devine 'selected' automat —
 * ramane 'review', ca utilizatorul sa confirme macar o data ca era
 * intentionat (bug real raportat: poze cu documente/texturi aprobate automat
 * alaturi de poze bune, fara nicio distinctie).
 */
/**
 * TEXT_DOMINANT_THRESHOLD: prag euristic (nu calibrat pe un set mare de date) —
 * peste aceasta fractiune din cadru acoperita de text (OCR nativ Android, vezi
 * core/nativeAnalysis.ts), cadrul e tratat ca document/captura de ecran
 * indiferent de fete/sceneTags — un document poate primi din intamplare o
 * eticheta COCO/scena (ex. "carte", "laptop") fara sa fie un subiect
 * fotografic real. Absent pe web/PWA (fara OCR acolo) — conditia devine
 * mereu falsa, deci fara efect.
 *
 * Exportat: core/documentShield.ts reutilizeaza acelasi prag pentru
 * "poza asta pare document/document sensibil" (UI de protectie, plan
 * modernizare) — un singur numar de calibrat, nu doua praguri care ar
 * putea diverge silentios.
 */
export const TEXT_DOMINANT_THRESHOLD = 0.15;

/**
 * Exportat pentru core/reviewClusters.ts: rezumatul cozii de verificat trebuie
 * sa numere EXACT pozele pe care aceasta functie le-a oprit, nu poze care
 * seamana cu ele. O a doua definitie a aceleiasi conditii ar fi doua pareri in
 * aceeasi aplicatie — acelasi motiv pentru care DEFECT_SHARPNESS se importa
 * acolo, nu se copiaza.
 */
export function hasNoRecognizableSubject(analysis: Pick<AnalysisRecord, 'faceCount' | 'sceneTags' | 'textCoverage'>): boolean {
  if (analysis.textCoverage !== undefined && analysis.textCoverage >= TEXT_DOMINANT_THRESHOLD) return true;
  // pickFolderSceneTag() ignora etichetele abstracte/non-subiect (ex. "Text",
  // "Photography", "Pattern" — vezi NON_FOLDER_SCENE_TAGS in sceneTagLabels.ts);
  // pe native (ML Kit, ~400 etichete Open Images) o poza fara fete poate primi
  // DOAR astfel de etichete abstracte si totusi trece testul `.length > 0` de
  // mai devreme — nu inseamna ca AI-ul a recunoscut un subiect fizic real.
  return analysis.faceCount === 0 && !pickFolderSceneTag(analysis.sceneTags);
}

/**
 * Bug real raportat de utilizator, cu exemplu concret: o poza cu o mana +
 * floare in prim-plan (nete, aproape de camera) si copilul din spate vizibil
 * neclar a fost aprobata automat — sharpness-ul GLOBAL (dominat de obiectul
 * ascutit din prim-plan) poate ramane mare chiar cand `subjectInFocus`
 * (comparatia REGIUNII subiectului fata de fundal, vezi scoreFocusAndBokeh in
 * faceAnalysis.worker.ts) a detectat corect ca subiectul insusi e neclar.
 * ContextEngine trateaza asta doar ca o GREUTATE invatata (poate fi
 * "acoperita" de alti factori buni), nu ca o regula stricta — exact ca
 * hasNoRecognizableSubject mai sus, un `subjectInFocus === false` confirmat
 * blocheaza auto-selectarea indiferent de scor, forteaza 'review'.
 * `!== true`, NU `!== false`: absent (nemasurabil) ramane neutru, nu
 * penalizat — acelasi principiu ca restul campurilor optionale din AnalysisRecord.
 */
function subjectConfirmedOutOfFocus(analysis: Pick<AnalysisRecord, 'subjectInFocus'>): boolean {
  return analysis.subjectInFocus === false;
}

/**
 * Singurul lucru din cadru e un obiect fabricat.
 *
 * Bug raportat cu captura, a doua oara: intr-o biblioteca cu un copil, cadrele
 * aprobate automat cu bifa verde erau un panou de pluta plin de bonuri (98), o
 * mana tinand cutia unui spray (82) si de doua ori coltul unei camere cu
 * televizorul (93, 95) — in timp ce o poza cu fetita primea 36. Nimic din
 * asta nu e o greseala de MASURARE: o coala plata, bine luminata, CHIAR e
 * clara si CHIAR e bine expusa. Scorul raspunde la "cat de bine e facut
 * cadrul", si raspunde corect.
 *
 * Greseala e ca raspunsul ala singur avea voie sa dea bifa. `hasNoRecognizableSubject`
 * pazea deja poarta, dar prin `pickFolderSceneTag`, care e o lista de nume
 * BUNE DE FOLDER, nu un test de subiect fotografic: "cutie", "televizor",
 * "hartie" trec, fiindca ar fi nume de folder rezonabile.
 *
 * Aici se pune intrebarea corecta: daca nu e nimeni in cadru SI etichetele
 * descriu in majoritate un lucru fabricat, poza nu se aproba singura. NU se
 * respinge — merge in 'review', adica exact unde utilizatorul cerea sa fie
 * pusa intrebarea. Un bon fotografiat poate fi lucrul cel mai important din
 * luna aia; doar nu poate fi asta HOTARAT de un scor de claritate.
 *
 * Peisajele, animalele, mancarea, arhitectura nu sunt atinse: niciuna nu are
 * etichete de lucru fabricat in majoritate.
 */
function onlyManufacturedSubject(analysis: Pick<AnalysisRecord, 'faceCount' | 'sceneTags'>): boolean {
  return analysis.faceCount === 0 && looksManufactured(analysis.sceneTags);
}

/**
 * In poza apare cineva pe care UTILIZATORUL l-a inrolat el insusi.
 *
 * Oglinda exacta a celor doua garantii de mai sus (hasNoRecognizableSubject,
 * subjectConfirmedOutOfFocus), care blocheaza auto-SELECTAREA. Aceasta
 * blocheaza auto-RESPINGEREA, dupa acelasi principiu: cand un semnal e destul
 * de puternic cat aplicatia sa nu fie sigura, nu decide singura — intreaba.
 *
 * De ce era nevoie: scorul masoara cat de BINE FACUTA e o poza. O coala de
 * hartie plata, bine luminata, e perfect clara si perfect expusa; un copil in
 * miscare nu e. Pentru un fotograf de nunta mestesugul E criteriul, dar pentru
 * pozele ocazionale — cazul tintit de aplicatie — nu e: acolo conteaza si CINE
 * e in cadru, nu doar cat de curat a iesit. Fara garantia asta, singura poza
 * dintr-o zi cu copilul putea fi aruncata automat pentru ca a iesit putin
 * miscata, inainte ca utilizatorul sa apuce s-o vada.
 *
 * DOAR persoanele inrolate, nu orice fata. "Orice fata" ar dezactiva practic
 * respingerea automata pe o galerie de familie, adica ar strica exact functia
 * pentru care exista aplicatia. Inrolarea e afirmatia explicita a
 * utilizatorului despre cine conteaza pentru el.
 *
 * Nu e acelasi lucru cu "Protejeaza mereu" (state/protectedPersons.ts), desi
 * seamana: acolo utilizatorul apasa un comutator, si efectul e asupra
 * operatiilor in MASA pe care le porneste tot el (Auto-Cull, respinge sub prag,
 * rezolva seriile). Aici e vorba de decizia automata de la import, pe care n-a
 * cerut-o nimeni — ea se intampla singura. Cea invizibila e cea care are mai
 * mare nevoie de o plasa.
 *
 * NU forteaza pastrarea si nu umfla niciun scor: poza ajunge la 'review', adica
 * fix in locul unde utilizatorul se uita oricum. O poate respinge cu o apasare.
 */
function showsKnownPerson(analysis: Pick<AnalysisRecord, 'knownFaceCount'>): boolean {
  return analysis.knownFaceCount > 0;
}

/**
 * Pragurile sub care o poza chiar are ceva in neregula. Aceleasi valori pe care
 * le foloseste deja aiExplanationGenerator ca sa SPUNA ce e in neregula — un
 * singur adevar: daca explicatia nu gaseste niciun defect de numit, decizia
 * automata n-are voie sa se poarte ca si cum ar fi gasit unul.
 */
/**
 * EXPORTATE ca interfata sa poata colora barele de metrici EXACT la pragul la
 * care motorul chiar numara un defect (vezi ui/MetricBar.tsx).
 *
 * De ce conteaza ca sunt aceleasi valori, si nu unele alese separat pentru
 * culoare: o bara rosie la 50 si un motor care considera defect abia sub 45 ar
 * fi doua opinii diferite in acelasi ecran, iar utilizatorul n-ar avea cum sa
 * afle care e cea care conteaza. Asa, culoarea nu e o parere despre poza — e
 * exact afirmatia "asta a contat la scor".
 */
export const DEFECT_SHARPNESS = 45;
const DEFECT_EXPOSURE_OFF = 15;
const DEFECT_CLIPPING = 0.06;
/** Sub atatea fete cu ochii deschisi, poza de grup chiar are o problema. */
export const DEFECT_EYES_OPEN_RATIO = 0.8;

/**
 * Are poza un defect REAL, care se poate numi?
 *
 * Bug real raportat de utilizator, cu capturi de pe telefon: 13 poze respinse
 * din 19, toate ale aceluiasi copil, toate clare si bine expuse, cu scoruri de
 * 0, 1, 4 si 6. Cauza de fond era normalizarea (vezi MIN_FEATURE_VARIANCE in
 * ContextEngine), dar mai era ceva, la fel de important: "respins" se decidea
 * EXCLUSIV dupa scor, iar scorul spune cat de sus sta poza fata de restul
 * bibliotecii, nu daca are ceva in neregula. Pe un lot omogen, cineva trebuie
 * sa fie ultimul — si acel ultim ajungea la cos fara sa aiba nimic.
 *
 * De aici incolo, respingerea automata cere DOUA lucruri deodata: scor mic SI
 * un defect care se poate numi. Fara defect, poza merge la 'review' — adica
 * exact acolo unde omul se uita oricum, si o poate respinge cu o apasare.
 * Nu forteaza pastrarea nimanui si nu umfla niciun scor.
 */
export function hasNamedDefect(
  a: Pick<AnalysisRecord, 'faceCount' | 'sharpness' | 'exposure' | 'highlightClipping' | 'shadowClipping'
    | 'allEyesOpen' | 'groupEyesOpenRatio' | 'subjectInFocus'>
): boolean {
  // Claritatea se judeca altfel cand exista un om in cadru decat pe un peisaj —
  // acelasi calcul ca in aiExplanationGenerator.effectiveSharpness.
  const sharpness = a.faceCount > 0 ? a.sharpness : landscapeSharpness(a.sharpness) * 100;
  if (sharpness < DEFECT_SHARPNESS) return true;
  if (Math.abs(a.exposure - 50) > DEFECT_EXPOSURE_OFF) return true;
  if ((a.highlightClipping ?? 0) > DEFECT_CLIPPING) return true;
  if ((a.shadowClipping ?? 0) > DEFECT_CLIPPING) return true;
  if (a.subjectInFocus === false) return true;
  if (a.faceCount > 0) {
    const eyesOpen = a.groupEyesOpenRatio ?? (a.allEyesOpen ? 1 : 0);
    if (eyesOpen < DEFECT_EYES_OPEN_RATIO) return true;
  }
  return false;
}

/**
 * Reutilizat de store.ts (rescorePhotos) ca sa clasifice exact la fel poze deja
 * existente, re-scorate cu un model ContextEngine actualizat.
 *
 * `thresholds` implicit = valorile fixe, deci orice apelant care nu stie de
 * adaptare se comporta exact ca inainte. Vezi core/scoreThresholds.ts pentru
 * cand si cat de mult se pot misca.
 */
export function decidePhotoStatus(
  score: number,
  analysis: Pick<AnalysisRecord, 'faceCount' | 'knownFaceCount' | 'sceneTags' | 'textCoverage' | 'subjectInFocus'
    | 'sharpness' | 'exposure' | 'highlightClipping' | 'shadowClipping' | 'allEyesOpen' | 'groupEyesOpenRatio'>,
  thresholds: Thresholds = FIXED_THRESHOLDS
): PhotoRecord['status'] {
  if (score <= thresholds.reject && !showsKnownPerson(analysis) && hasNamedDefect(analysis)) return 'rejected';
  if (
    score >= thresholds.select
    && !hasNoRecognizableSubject(analysis)
    && !onlyManufacturedSubject(analysis)
    && !subjectConfirmedOutOfFocus(analysis)
  ) return 'selected';
  return 'review';
}

/**
 * Scorurile AI ale intregii biblioteci, sortate crescator — citite direct din
 * indexul Dexie pe `aiScore`, deci fara sa incarce inregistrarile de analiza in
 * memorie si fara sa sorteze nimic in JS.
 */
export async function readLibraryScores(): Promise<number[]> {
  return (await db.analyses.orderBy('aiScore').keys()) as number[];
}
/** EXIF sta mereu aproape de inceputul fisierului (segment APP1, imediat dupa
    SOI) — citim doar un prefix, nu tot fisierul, ca sa nu incarcam inutil in
    memorie poze mari doar pentru cativa octeti de metadate. */
const EXIF_SNIFF_BYTES = 131072;

/**
 * Fisierele originale raman disponibile doar in memorie, pentru sesiunea
 * curenta de import — nu sunt persistate in IndexedDB (ar dubla spatiul
 * ocupat de 1000+ poze originale, unele RAW de zeci de MB). Un File e un
 * handle lazy catre disc, nu bytes incarcati in RAM, deci pastrarea
 * referintei e ieftina; abia exportOriginalFiles() ii citeste continutul.
 * La reload de pagina se pierde — pozele reincarcate din DB nu mai pot fi
 * exportate in format original decat prin reimport.
 */
export const originalFiles = new Map<string, File>();

/**
 * Cand importul a folosit File System Access API (filePicker.ts), pastram si
 * handle-ul alaturi de File — spre deosebire de `originalFiles`, acesta
 * SUPRAVIETUIESTE unui reload (persistat in db.fileHandles la selectie, vezi
 * syncOriginal in state/store.ts), fara sa dubleze bytes-ii originalului in
 * IndexedDB. Absent pentru importuri prin <input type="file"> (fallback).
 */
export const originalHandles = new Map<string, FileSystemFileHandleLike>();

const DECODE_TIMEOUT_MS = 30000;

async function decode(file: File, mediaUri?: string): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  // `late => late.close()`: un timeout nu anuleaza decodarea de dedesubt, doar
  // inceteaza s-o astepte — fara acest carlig, bitmap-ul care soseste tarziu
  // (pana la ~16 MB la 2048px) nu mai era inchis de nimeni, niciodata. Vezi
  // comentariul lung de la withTimeout in core/workerPool.ts.
  const closeLate = (late: ImageBitmap) => late.close();
  try {
    bitmap = await withTimeout(
      createImageBitmap(file, { resizeWidth: PREVIEW_MAX_SIDE, resizeQuality: 'high' } as ImageBitmapOptions),
      DECODE_TIMEOUT_MS,
      'Decodarea a durat prea mult.',
      closeLate
    );
  } catch {
    try {
      bitmap = await withTimeout(createImageBitmap(file), DECODE_TIMEOUT_MS, 'Decodarea a durat prea mult.', closeLate);
    } catch (err) {
      // Ultima incercare, si singura care mai poate reusi: HEIC/HEIF.
      //
      // Chromium din WebView nu decodeaza HEIC in <canvas>, iar HEIC e formatul
      // implicit pe iPhone si pe multe telefoane Android moderne — inclusiv cand
      // telefonul salveaza HEIC dar eticheteaza fisierul .jpg cu MIME
      // "image/jpeg" (vezi sniffRealFormat mai jos), caz in care nici filtrul de
      // format nu-l putea opri. Rezultatul, pana acum: poza lipsa din import si
      // un motiv tehnic pe care nu-l poate folosi nimeni.
      //
      // Telefonul stie insa formatul: BitmapFactory decodeaza HEIF de la Android
      // 9 in sus, pe codecul hardware. Cerem NUMAI dupa ce decodarea normala a
      // esuat deja si numai daca fisierul chiar e HEIC — deci pe importurile
      // obisnuite drumul asta nu se atinge niciodata.
      if ((await sniffRealFormat(file)) !== 'HEIC/HEIF' || !(await isHeicDecodingSupported())) throw err;
      const jpeg = await decodeHeicToJpegBlob(file, mediaUri);
      bitmap = await withTimeout(createImageBitmap(jpeg), DECODE_TIMEOUT_MS, 'Decodarea a durat prea mult.', closeLate);
    }
  }
  return capToPreviewSize(bitmap);
}

/**
 * createImageBitmap cu un singur `resizeWidth` limiteaza doar LATIMEA, nu latura cea mai
 * lunga (contrar comentariului din header al fisierului) — la poze portret (foarte comune:
 * poze de telefon, cadre 9:16) inaltimea rezultata poate depasi cu mult PREVIEW_MAX_SIDE.
 * Fallback-ul de mai sus (decodare fara nicio limita, cand resize-ul esueaza) poate produce
 * un bitmap la rezolutie nativa complet nemarginita (risc real de OOM in WebView Android pe
 * poze de 48-108MP). Bug real gasit de auditul QA — recadram aici pe AMBELE axe, o singura
 * data, indiferent de calea care a produs bitmap-ul, ca sa garantam invariantul "preview <=
 * 2048px pe latura cea mai lunga" asumat in tot restul aplicatiei (buget de stocare,
 * scorarea claritatii).
 */
async function capToPreviewSize(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= PREVIEW_MAX_SIDE) return bitmap;
  const scale = PREVIEW_MAX_SIDE / longest;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * scale));
  c.height = Math.max(1, Math.round(bitmap.height * scale));
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return createImageBitmap(c);
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
  );
}

/**
 * Latura pozei trimise pre-scanarii. Mult sub PREVIEW_MAX_SIDE — scop DOAR sa
 * decidem ordinea de procesare, nu sa mai extragem vreun semnal fin.
 *
 * A fost 320, si la 320 pasul asta nu-si facea treaba. Documentatia ML Kit cere
 * imagini de cel putin 480x360 pentru detectia de fete, si spune ca o fata are
 * nevoie de vreo 100x100 px ca sa fie gasita de incredere. La 320 px latura
 * lunga, INTREAGA imagine era sub minimul documentat, iar 100 px insemna o fata
 * cat o treime din cadru — adica se gaseau doar prim-planurile. Un grup, un
 * copil la cativa metri, orice portret de mediu: ratate. Deci pasul costa timp
 * pe fiecare poza din lot si intorcea "nu e nimeni" tocmai pentru pozele pe
 * care utilizatorul ceruse sa le vada primele.
 *
 * La 640, aceiasi 100 px inseamna o fata cat ~16% din cadru: intra portretele
 * si grupurile obisnuite. Pixelii in plus se platesc din ce s-a taiat in
 * acelasi timp — pre-scanarea foloseste acum detectorul RAPID, fara clasificare
 * si fara contururi (vezi `fast` in core/nativeFaceDetection.ts), fiindca din
 * tot ce intorcea citea oricum un singur lucru: daca lista de fete e goala sau
 * nu. Zambetul si ochii deschisi se calculau pe fiecare fata din lot si se
 * aruncau.
 *
 * Un fals negativ ramane inofensiv prin constructie: poza doar nu e
 * prioritizata, si e oricum re-analizata complet, la rezolutie mare, mai
 * tarziu.
 */
const FACE_PRESCAN_SIZE = 640;
/** Cate poze de la inceputul lotului trec prin pre-scanare — vezi prioritizeFacesFirst pentru de ce nu tot lotul. */
const FACE_PRESCAN_MAX = 150;
const FACE_PRESCAN_TIMEOUT_MS = 8000;
/** Independent de analysisPool.size — pasul e usor (un decode mic + un apel ML Kit), poate rula cu mai mult paralelism decat analiza completa. */
const FACE_PRESCAN_CONCURRENCY = 4;
/** Sub acest numar de poze, reordonarea n-are niciun beneficiu vizibil (biblioteca mica = oricum gata rapid) — doar cost adaugat degeaba. */
const FACE_PRESCAN_MIN_BATCH = 4;

/**
 * Cerinta directa a utilizatorului: la un import mare, pozele cu OAMENI (cel
 * mai adesea subiectul important intr-o sedinta foto) sa fie gata de triat
 * primele, restul continuand analiza completa in fundal — asa poti incepe
 * culling-ul imediat, nu abia dupa ce se termina tot lotul.
 *
 * DOAR pe Android (native, ML Kit) — pe web/PWA, Human.js NU separa ieftin
 * detectia de fete de restul analizei (compozitie/claritate/etc. vin din
 * ACELASI apel human.detect()), deci o pre-scanare acolo ar insemna sa rulam
 * analiza de doua ori pe fiecare poza, incetinind importul global, exact
 * opusul scopului — web/PWA ramane neschimbat, ordinea ramane cea din urma
 * (cum a ales-o utilizatorul in selector).
 *
 * Decodare MICA (vezi FACE_PRESCAN_SIZE, calitate redusa) + un singur apel ML
 * Kit per poza, in modul RAPID —
 * mult mai ieftin decat decodarea completa (2048px) + restul pipeline-ului
 * din processOne, care oricum va re-detecta fetele la rezolutie completa
 * (necesar pentru cutii precise de compozitie/focus) — cateva zeci de ms in
 * plus per poza, acceptabil pentru beneficiul de a vedea pozele cu oameni
 * primele. Partitie STABILA (nu un sort complet): fetele intai, in ordinea
 * originala intre ele, apoi restul, tot in ordinea originala — nu amestecam
 * inutil ordinea din care utilizatorul a ales fisierele.
 *
 * Orice esec per-poza (decodare, plugin indisponibil temporar) o lasa pur si
 * simplu in grupul neprioritizat — o pre-scanare esuata NU trebuie sa
 * blocheze sau sa strice importul real, care oricum reincearca detectia la
 * rezolutie completa mai tarziu.
 */
/** Calea de pre-scanare fara URI de galerie (selector de fisiere): decodare mica in JS, apoi acelasi detector nativ. */
async function prescanViaCanvas(file: File) {
  const bitmap = await createImageBitmap(file, { resizeWidth: FACE_PRESCAN_SIZE, resizeQuality: 'low' } as ImageBitmapOptions);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return detectFacesNative({ blob: await canvasToJpeg(c, 0.7) }, { fast: true });
}

/** Exportata doar pentru testabilitate directa (prioritizeFacesFirst.test.ts) — la fel ca toHashInput/decidePhotoStatus mai sus. */
export async function prioritizeFacesFirst<T extends { file: File; mediaUri?: string }>(
  images: T[],
  onScanned?: (done: number, total: number) => void
): Promise<T[]> {
  if (!isNativeFaceDetectionAvailable() || images.length < FACE_PRESCAN_MIN_BATCH) return images;

  // Pre-scanam doar INCEPUTUL lotului. Costul e liniar (un apel de detectie per
  // poza), dar folosul nu e: rostul ordonarii e sa ai poze cu oameni de triat
  // IMEDIAT, iar asta se decide in primele cateva zeci, nu in a 400-a. Pe un
  // lot de 437 de poze, pre-scanarea completa lua ~2 minute inainte ca analiza
  // sa inceapa macar — raportat de utilizator, si pe deasupra sub eticheta
  // gresita "Se incarca modelele AI". Restul lotului isi pastreaza ordinea.
  const scanCount = Math.min(images.length, FACE_PRESCAN_MAX);
  const hasFace = new Array<boolean>(images.length).fill(false);
  let scanned = 0;
  let index = 0;
  await Promise.all(
    Array.from({ length: FACE_PRESCAN_CONCURRENCY }, async () => {
      while (true) {
        const i = index++;
        if (i >= scanCount) break;
        const { file, mediaUri } = images[i];
        // RAW-urile nu se decodeaza cu createImageBitmap (necesita decodeRawFile,
        // mult mai costisitor) — le lasam neprioritizate, nu merita costul complet
        // al unui decoder RAW doar ca sa decidem ordinea.
        //
        // Bug real gasit de auditul QA: `continue` sarea si peste onScanned(),
        // nu doar peste detectie — deci pentru un lot care contine si RAW-uri,
        // ultimul progres raportat era mereu SUB total (ex. "3/6" pentru 6
        // fisiere din care 3 CR2/NEF/ARW), iar bara fazei "pregatire" ramanea
        // inghetata la ~50% pana cand faza urmatoare o inlocuia. Fisierul CHIAR
        // a trecut prin pre-scanare (decizia fiind "il lasam neprioritizat"),
        // deci trebuie sa se numere ca atare.
        if (RAW_EXTENSIONS.test(file.name)) { onScanned?.(++scanned, scanCount); continue; }
        try {
          // Cu URI de galerie, pre-scanarea nu mai decodeaza nimic in JS: partea
          // nativa citeste direct din MediaStore, subesantionat la dimensiunea
          // ceruta. Inainte, doar ca sa decida ORDINEA, fiecare poza trecea
          // printr-o decodare JPEG completa in JS (rezultat mic, dar decodarea
          // in sine e integrala), plus o recodare si un base64.
          const result = await withTimeout(
            mediaUri
              ? detectFacesNative({ uri: mediaUri, maxSide: FACE_PRESCAN_SIZE }, { fast: true })
              : prescanViaCanvas(file),
            FACE_PRESCAN_TIMEOUT_MS,
            'Pre-scanare fete: decodare prea lenta.'
          );
          hasFace[i] = result.faces.length > 0;
        } catch {
          // esec per-poza (decodare/plugin) -> ramane in grupul neprioritizat, nu blocam pre-scanarea pentru atat
        }
        onScanned?.(++scanned, scanCount);
      }
    })
  );

  const withFace: T[] = [];
  const withoutFace: T[] = [];
  images.forEach((img, i) => (hasFace[i] ? withFace : withoutFace).push(img));
  return [...withFace, ...withoutFace];
}

function makeDerivatives(bitmap: ImageBitmap): {
  preview: Promise<Blob>; thumb: Promise<Blob>; lqip: string; dHash: string; w: number; h: number;
} {
  // Preview la rezolutia decodata (max 2048) — pe acesta se evalueaza claritatea
  const pc = document.createElement('canvas');
  pc.width = bitmap.width; pc.height = bitmap.height;
  pc.getContext('2d')!.drawImage(bitmap, 0, 0);
  const preview = canvasToJpeg(pc, 0.88);

  // Miniatura pentru grila
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
  const tc = document.createElement('canvas');
  tc.width = Math.max(1, Math.round(bitmap.width * scale));
  tc.height = Math.max(1, Math.round(bitmap.height * scale));
  tc.getContext('2d')!.drawImage(bitmap, 0, 0, tc.width, tc.height);
  const thumb = canvasToJpeg(tc, 0.82);

  // LQIP: cateva zeci de pixeli, suficient pentru un blur placeholder — generat
  // sincron (toDataURL, nu toBlob) ca sa fie disponibil imediat, fara alt await.
  const lqScale = Math.min(1, LQIP_SIZE / Math.max(bitmap.width, bitmap.height));
  const lc = document.createElement('canvas');
  lc.width = Math.max(1, Math.round(bitmap.width * lqScale));
  lc.height = Math.max(1, Math.round(bitmap.height * lqScale));
  lc.getContext('2d')!.drawImage(bitmap, 0, 0, lc.width, lc.height);
  const lqip = lc.toDataURL('image/jpeg', 0.5);

  // dHash 9x8 pentru serii/duplicate
  const hc = document.createElement('canvas');
  hc.width = 9; hc.height = 8;
  const hctx = hc.getContext('2d', { willReadFrequently: true })!;
  hctx.drawImage(bitmap, 0, 0, 9, 8);
  const d = hctx.getImageData(0, 0, 9, 8).data;
  let hash = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      const j = (y * 9 + x + 1) * 4;
      const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      hash += a > b ? '1' : '0';
    }
  }

  return { preview, thumb, lqip, dHash: hash, w: bitmap.width, h: bitmap.height };
}

/**
 * Nu ne bazam pe navigator.storage.estimate() pentru a opri importul preventiv:
 * raportarea e nesigura in practica — Brave, de exemplu, ofusca deliberat
 * usage/quota din motive de anti-fingerprinting, ceea ce a produs opriri false
 * ("stocare aproape plina") chiar si cu 2 poze mici pe un telefon cu spatiu liber.
 * Reactionam DOAR la un esec real de scriere (QuotaExceededError), singurul
 * semnal 100% de incredere — reflecta o eroare reala, nu o estimare.
 */
function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

/**
 * Verifica formatul REAL al fisierului din primii octeti (magic bytes), nu din
 * extensie/MIME — unele telefoane (multe Samsung/Xiaomi) salveaza pozele in
 * HEIC/HEIF dar le expun aplicatiilor cu extensia .jpg si MIME "image/jpeg"
 * (compatibilitate "falsa"), ceea ce trece de filtrul de format dar pica la
 * decodare cu "InvalidStateError: source image could not be decoded" —
 * Chromium pe Android nu decodeaza HEIC in <canvas>. Folosit doar cand
 * decodarea a esuat deja, ca sa dam un motiv exact, nu o presupunere.
 */
async function sniffRealFormat(file: File): Promise<string | null> {
  try {
    const buf = await file.slice(0, 16).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return null; // JPEG real — nu e asta problema
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return null; // PNG real
    if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return null; // WEBP real
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { // 'ftyp' -> container ISO BMFF
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(brand)) return 'HEIC/HEIF';
      if (/^(avif|avis)$/.test(brand)) return 'AVIF';
      return 'necunoscut (' + brand + ')';
    }
    return 'necunoscut';
  } catch {
    return null;
  }
}

/** Construieste intrarea folosita de gruparea dupa dHash (hashCompare.worker.ts) din campurile deja calculate de analiza AI. */
export function toHashInput(id: string, dHash: string, a: AnalysisRecord, capturedAt?: number): HashInput {
  return {
    id,
    hash: dHash,
    ...(capturedAt !== undefined ? { capturedAt } : {}),
    score: a.aiScore,
    sharpness: a.sharpness,
    exposure: a.exposure,
    compositionScore: a.compositionScore,
    faceCount: a.faceCount,
    bestSmile: a.bestSmile,
    groupSmileRatio: a.groupSmileRatio,
    allEyesOpen: a.allEyesOpen,
    groupEyesOpenRatio: a.groupEyesOpenRatio,
    groupAwkwardRatio: a.groupAwkwardRatio,
    subjectInFocus: a.subjectInFocus,
    highlightClipping: a.highlightClipping,
    avgEyeContact: a.avgEyeContact,
    faceEmbeddings: a.faces.map(f => f.embedding).filter((e): e is number[] => !!e && e.length > 0),
    imageEmbedding: a.imageEmbedding,
    colorHarmonyScore: a.colorHarmonyScore,
    dominantColors: a.dominantColors
  };
}

async function processOne(file: File, genre?: string, project?: string, handle?: FileSystemFileHandleLike, mediaUri?: string, thresholds: Thresholds = FIXED_THRESHOLDS, mediaLocation?: MediaLocation): Promise<ImportedPhoto> {
  const id = crypto.randomUUID();
  const isRaw = isRawFile(file);
  // RAW (CR2/NEF/ARW/DNG/...) nu se decodeaza cu createImageBitmap — folosim
  // LibRaw (WASM); metadatele EXIF vin direct din LibRaw (mai fiabil decat
  // sniff-ul de octeti gandit pentru JPEG, care nu intelege containerul RAW).
  // Etapele de mai jos sunt cronometrate separat (core/stageTiming.ts): un
  // import lent poate fi decodare, analiza AI, EXIF sau scriere in baza de
  // date, iar din afara toate arata identic — "e lent".
  const { bitmap, rawMeta } = await timed('decode', async () => isRaw
    ? decodeRawFile(file).then(r => ({ bitmap: r.bitmap, rawMeta: r.meta }))
    : { bitmap: await decode(file, mediaUri), rawMeta: undefined });
  const { preview, thumb, lqip, dHash, w, h } = timedSync('derivatives', () => makeDerivatives(bitmap));

  // Bitmap-ul pleaca in worker (transfer, zero-copy) — de aici nu-l mai atingem
  // mediaUri doar pentru non-RAW: BitmapFactory (Android) nu stie CR2/NEF —
  // acelea raman pe calea cu blob, decodate deja in JS de LibRaw.
  const analysisStart = performance.now();
  const analysisPromise = analysisPool.analyze(id, bitmap, isRaw ? undefined : mediaUri);
  const [previewBlob, thumbBlob] = await Promise.all([preview, thumb]);

  const analysis = await analysisPromise;
  // Masurat de la pornirea analizei pana la rezultat, nu doar `await`-ul de
  // mai sus: encodarea preview/thumb ruleaza in paralel cu ea, deci un simplu
  // timp petrecut in ultimul await ar raporta aproape zero pe pozele unde
  // analiza s-a terminat prima.
  record('analysis', performance.now() - analysisStart);

  // EXIF (ISO/diafragma/timp expunere/focala/data capturii) — optional, poze fara EXIF
  // (PNG/WebP sau JPEG cu metadate sterse) nu primesc aceste campuri deloc
  let capturedAt: number | undefined;
  if (rawMeta) {
    if (rawMeta.iso !== undefined) analysis.iso = rawMeta.iso;
    if (rawMeta.fNumber !== undefined) analysis.fNumber = rawMeta.fNumber;
    if (rawMeta.exposureTime !== undefined) analysis.exposureTime = rawMeta.exposureTime;
    if (rawMeta.focalLength !== undefined) analysis.focalLength = rawMeta.focalLength;
    if (rawMeta.make !== undefined) analysis.cameraMake = rawMeta.make;
    if (rawMeta.model !== undefined) analysis.cameraModel = rawMeta.model;
    if (rawMeta.lensModel !== undefined) analysis.lensModel = rawMeta.lensModel;
    if (rawMeta.software !== undefined) analysis.exifSoftware = rawMeta.software;
    if (rawMeta.artist !== undefined) analysis.exifArtist = rawMeta.artist;
    if (rawMeta.focalLength35mm !== undefined) analysis.focalLength35mm = rawMeta.focalLength35mm;
    if (rawMeta.gpsLatitude !== undefined) analysis.gpsLatitude = rawMeta.gpsLatitude;
    if (rawMeta.gpsLongitude !== undefined) analysis.gpsLongitude = rawMeta.gpsLongitude;
    capturedAt = rawMeta.capturedAt;
  } else {
    try {
      const exifBuf = await timed('exif', () => file.slice(0, EXIF_SNIFF_BYTES).arrayBuffer());
      const exif = parseExif(exifBuf);
      if (exif.iso !== undefined) analysis.iso = exif.iso;
      if (exif.fNumber !== undefined) analysis.fNumber = exif.fNumber;
      if (exif.exposureTime !== undefined) analysis.exposureTime = exif.exposureTime;
      if (exif.focalLength !== undefined) analysis.focalLength = exif.focalLength;
      if (exif.make !== undefined) analysis.cameraMake = exif.make;
      if (exif.model !== undefined) analysis.cameraModel = exif.model;
      if (exif.lensModel !== undefined) analysis.lensModel = exif.lensModel;
      if (exif.software !== undefined) analysis.exifSoftware = exif.software;
      if (exif.artist !== undefined) analysis.exifArtist = exif.artist;
      if (exif.copyright !== undefined) analysis.exifCopyright = exif.copyright;
      if (exif.exposureBias !== undefined) analysis.exposureBias = exif.exposureBias;
      if (exif.meteringMode !== undefined) analysis.meteringMode = exif.meteringMode;
      if (exif.flashFired !== undefined) analysis.flashFired = exif.flashFired;
      if (exif.whiteBalance !== undefined) analysis.whiteBalance = exif.whiteBalance;
      if (exif.focalLength35mm !== undefined) analysis.focalLength35mm = exif.focalLength35mm;
      if (exif.gpsAccuracyM !== undefined) analysis.gpsAccuracyM = exif.gpsAccuracyM;
      if (exif.gpsLatitude !== undefined) analysis.gpsLatitude = exif.gpsLatitude;
      if (exif.gpsLongitude !== undefined) analysis.gpsLongitude = exif.gpsLongitude;
      capturedAt = exif.capturedAt;

      // IPTC-IIM (segment Photoshop APP13, distinct de EXIF) — acelasi prefix deja citit mai sus,
      // fara o a doua citire de pe disc (semnatura Photoshop e mereu aproape de inceputul fisierului)
      const iptc = parseIptc(exifBuf);
      if (iptc.byline !== undefined) analysis.iptcByline = iptc.byline;
      if (iptc.caption !== undefined) analysis.iptcCaption = iptc.caption;
      if (iptc.headline !== undefined) analysis.iptcHeadline = iptc.headline;
      if (iptc.credit !== undefined) analysis.iptcCredit = iptc.credit;
      if (iptc.source !== undefined) analysis.iptcSource = iptc.source;
      if (iptc.copyright !== undefined) analysis.iptcCopyright = iptc.copyright;
      if (iptc.city !== undefined) analysis.iptcCity = iptc.city;
      if (iptc.country !== undefined) analysis.iptcCountry = iptc.country;
      if (iptc.keywords !== undefined) analysis.iptcKeywords = iptc.keywords;
    } catch (err) {
      console.error('Citire EXIF esuata pentru ' + file.name + ':', err);
    }
  }

  // Coordonatele citite NATIV, cand EXIF-ul din bytes-ii primiti n-are niciuna.
  //
  // Bug real raportat de utilizator: "faza cu calatorii (azi Locatii), nu apare niciodata
  // nimic, cred ca nu citeste locatia pozelor" — exact asa era. Incepand cu
  // Android 10, MediaStore REDACTEAZA (sterge) tag-urile GPS din fisierul pe
  // care il primeste o aplicatie, chiar daca poza chiar are locatie si chiar
  // daca aplicatia are voie sa citeasca poza. Parserul EXIF de mai sus e
  // corect; pur si simplu nu avea ce gasi, deci nicio poza n-avea coordonate,
  // deci state/locations.ts nu avea ce grupa pe locuri, niciodata.
  //
  // Singura cale oficiala e permisiunea ACCESS_MEDIA_LOCATION plus o citire
  // facuta prin MediaStore.setRequireOriginal() — deci nativ, nu din WebView:
  // vezi MediaLibraryPlugin.kt:photoLocations si nativeMediaLibrary.ts.
  //
  // `hasRealGps`, nu `=== undefined`: cand Android redacteaza locatia, de multe
  // ori LASA tag-urile GPS in EXIF, cu valoarea zero. Deci campul chiar exista,
  // are valoarea 0, si o verificare pe "lipseste?" n-ar completa niciodata
  // nimic — exact capcana in care intrase prima varianta a acestei reparatii.
  if (!hasRealGps(analysis.gpsLatitude, analysis.gpsLongitude)) {
    delete analysis.gpsLatitude;
    delete analysis.gpsLongitude;
    if (mediaLocation) {
      analysis.gpsLatitude = mediaLocation.latitude;
      analysis.gpsLongitude = mediaLocation.longitude;
    }
  }

  const prediction = await contextEngine.predict(analysis, genre);
  analysis.aiScore = prediction.score;
  analysis.aiFactors = prediction.topFactors;
  analysis.aiUncertainty = prediction.uncertainty;
  analysis.aiPersonalDelta = prediction.personalDelta;

  const status = decidePhotoStatus(prediction.score, analysis, thresholds);

  const photo: PhotoRecord = {
    id,
    fileName: file.name,
    // preferam data reala a capturii (ceasul aparatului, din EXIF/RAW) — file.lastModified
    // reflecta adesea momentul COPIERII pe disc (card nou, transfer intre calculatoare,
    // sincronizare cloud), care poate diferi mult de momentul declansarii, mai ales cu
    // mai multe aparate/carduri la acelasi eveniment
    capturedAt: capturedAt ?? file.lastModified,
    importedAt: Date.now(),
    width: w,
    height: h,
    dHash,
    lqip,
    status,
    // Statusul de la import vine din decidePhotoStatus, deci e al MOTORULUI:
    // severitatea are voie sa-l rescrie mai tarziu, cat timp omul nu s-a atins
    // de poza. Vezi core/aiDecision.ts pentru ce a costat lipsa lui.
    aiDecided: true,
    sizeBytes: file.size,
    // sir gol, NU absent — vezi db.ts v6 pentru motiv (indexul groupId exclude
    // orice inregistrare cu campul absent; '' acopera indexul de la inceput,
    // ramanand falsy identic cu "absent" pentru tot codul existent)
    groupId: '',
    ...(genre?.trim() ? { genre: genre.trim() } : {}),
    ...(project?.trim() ? { project: project.trim() } : {}),
    ...(mediaUri ? { mediaUri } : {})
  };

  // Bug real gasit de auditul QA: cele 4-5 scrieri de mai jos (o singura poza,
  // mai multe tabele) rulau printr-un simplu Promise.all, in afara oricarei
  // tranzactii Dexie — daca tab-ul/procesul era omorat la mijloc (crash,
  // inchidere fortata, OOM), o poza putea ramane cu un rand in `photos` dar
  // fara `thumbnails`/`analyses` corespunzator: un record orfan/partial, cu
  // un UUID proaspat pe care un reimport nu-l suprascrie si nu-l repara
  // singur. db.transaction face toate scrierile atomice: ori toate reusesc,
  // ori (la orice eroare) niciuna nu se aplica.
  await timed('persist', () => db.transaction('rw', [db.photos, db.thumbnails, db.previews, db.analyses, db.fileHandles, db.originals], async () => {
    await Promise.all([
      db.photos.put(photo),
      db.thumbnails.put({ photoId: id, blob: thumbBlob }),
      db.previews.put({ photoId: id, blob: previewBlob }),
      db.analyses.put(analysis),
      // pastram originalul si pentru auto-selectiile AI (nu doar corectiile
      // manuale) — altfel exportul s-ar rupe la un reload inainte ca utilizatorul
      // sa apuce sa atinga poza (vezi syncOriginal in state/store.ts). Preferam
      // handle-ul (cateva zeci de octeti) fata de o copie completa a blob-ului
      // cand File System Access API e disponibil (plan 2.3.4).
      ...(status === 'selected'
        ? [handle
            ? db.fileHandles.put({ photoId: id, handle })
            : db.originals.put({ photoId: id, blob: file, fileName: file.name, type: file.type })]
        : [])
    ]);
  }));

  // Bug real gasit de auditul QA (scurgere de memorie): cele doua Map-uri
  // modulare erau populate la INCEPUTUL functiei, inainte de tot ce poate
  // esua (decodare RAW/LibRaw, analiza AI cu timeout, scrierile in Dexie).
  // La orice esec per-poza, importFiles prinde eroarea si trece mai departe —
  // dar intrarea ramanea acolo pentru tot restul sesiunii, cu un UUID pe care
  // NICIO inregistrare din DB nu-l referentiaza, deci pe care nimic nu-l mai
  // sterge vreodata (nici clearSession, care itereaza pozele reale). Un
  // director cu 200 de fisiere corupte/HEIC-mascate reimportat de cateva ori
  // acumula tot atatea File-uri "fantoma", fiecare tinand viu un handle catre
  // fisierul de pe disc. Inregistram abia dupa ce poza CHIAR exista in DB —
  // singurul moment din care exportOriginalFiles are ce cauta dupa acest id.
  originalFiles.set(id, file);
  if (handle) originalHandles.set(id, handle);

  return { photo, analysis, prediction };
}

/**
 * Token de anulare simplu (mutabil, verificat in bucla de import) — un
 * AbortController ar fi mai idiomatic, dar bucla e un pool manual de
 * "workeri" (Promise.all peste N task-uri concurente), nu un singur fetch:
 * flag-ul mutabil, verificat la fiecare iteratie, e cel mai simplu mod de a
 * opri toate task-urile concurente in acelasi punct.
 */
export interface ImportCancelToken { cancelled: boolean; }
export function createCancelToken(): ImportCancelToken { return { cancelled: false }; }

export async function importFiles(
  files: File[],
  onProgressRaw: (p: ImportProgress) => void,
  onPhoto: (item: ImportedPhoto) => void,
  cancelToken?: ImportCancelToken,
  /** Genul fotografic activ (ex. "Nunta", "Portret") — vezi ContextEngine.deriveContextKey. */
  genre?: string,
  /** Numele proiectului/sesiunii active (ProjectNameField) — vezi PhotoRecord.project. */
  project?: string,
  /** Handle-uri File System Access API, aliniate index-cu-index cu `files` (vezi filePicker.ts pickImportFiles). Absent = import prin <input type="file">. */
  handles?: (FileSystemFileHandleLike | undefined)[],
  /** URI-uri content:// Android, aliniate index-cu-index cu `files` (vezi nativeMediaLibrary.ts pickNativePhotos). Absent = import prin <input type="file"> sau pe web/PWA — vezi PhotoRecord.mediaUri. */
  mediaUris?: (string | undefined)[],
  /** Coordonatele citite nativ, pe URI (vezi nativeMediaLibrary.ts readNativePhotoLocations si comentariul din processOne despre redactarea GPS de catre MediaStore). */
  mediaLocations?: Map<string, MediaLocation>
): Promise<Map<string, string>> {
  // Progresul trece printr-un invelis care retine ULTIMA stare trimisa.
  // Scanarea rapida de duplicate (mai jos) se termina intr-un moment
  // imprevizibil — trebuie sa ADAUGE cifra la starea curenta, nu sa inventeze
  // o faza: altfel ecranul ar sari inapoi la "incarcare" in mijlocul analizei.
  let lastProgress: ImportProgress = { done: 0, total: files.length, fileName: '', phase: 'incarcare' };
  const onProgress = (p: ImportProgress) => { lastProgress = p; onProgressRaw(p); };

  // faza separata (nu "analiza 0/N"): la primul import, descarca modelele AI
  // (cateva zeci de MB) — poate dura, si utilizatorul trebuie sa stie de ce.
  onProgress({ done: 0, total: files.length, fileName: '', phase: 'incarcare' });

  // pastram fisierul si handle-ul corespunzator impreuna INAINTE de a filtra
  // dupa format — altfel indexul din `handles` s-ar decala fata de `files`
  // de indata ce un fisier neacceptat (ex. HEIC) e exclus din mijlocul listei.
  const pairs = files.map((file, i) => ({ file, handle: handles?.[i], mediaUri: mediaUris?.[i] }));
  // HEIC intra in import DOAR daca telefonul chiar stie sa-l decodeze (Android 9+,
  // prin HeicDecoderPlugin.kt). Intrebarea se pune o singura data pe import, nu
  // per fisier — raspunsul e memorat oricum in nativeHeicDecoder.ts.
  //
  // Pana acum era exclus aici, neconditionat, cu tot cu extensia lui adevarata.
  // Adica formatul implicit de pe iPhone si de pe multe telefoane Android
  // moderne nu ajungea niciodata la decodare. Pe un telefon care NU-l poate
  // decoda ramane exclus, si atunci mesajul de mai jos e cel corect: mai bine
  // spui din start ca nu se poate, decat sa incerci si sa esuezi pe fiecare.
  const heicOk = await isHeicDecodingSupported();
  let images = pairs.filter(({ file: f }) =>
    /image\/(jpeg|png|webp|avif)/.test(f.type) || /\.(jpe?g|png|webp|avif)$/i.test(f.name) || RAW_EXTENSIONS.test(f.name)
    || (heicOk && (/image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name)))
  );
  // Cate au fost lasate deoparte dintr-o selectie MIXTA. Pana acum, un clip
  // video sau un HEIC ales din greseala disparea in tacere: utilizatorul alegea
  // 20 de fisiere, se importau 18, si nimic nu spunea de ce. Cazul "niciunul
  // suportat" avea deja mesaj (mai jos), cazul partial nu.
  const skippedCount = pairs.length - images.length;
  // Daca niciun fisier ales nu are un format suportat (ex. HEIC/HEIF de pe iPhone,
  // sau un director gol), bucla de mai jos nu are ce procesa si totul se termina
  // instant, fara nicio poza si fara nicio eroare — utilizatorul vede doar ca
  // "nu s-a intamplat nimic". Semnalam explicit acest caz.
  if (images.length === 0) {
    const warning = files.length > 0
      ? `Niciunul dintre cele ${files.length} fisiere alese nu e intr-un format suportat ` +
        `(JPEG/PNG/WebP/AVIF/RAW). HEIC/HEIF de pe iPhone nu e suportat inca — converteste-le in JPEG.`
      : undefined;
    onProgress({
      done: 0, total: 0, fileName: '', phase: 'finalizat', warning,
      outcome: { total: 0, imported: 0, failed: 0, skipped: pairs.length }
    });
    return new Map();
  }

  // Scanarea rapida de copii identice. Sta AICI, inaintea lui analysisPool.init(),
  // si nu se asteapta: incarcarea modelelor AI e cea mai lunga pauza din tot
  // importul, si pana acum era complet goala. Scanarea nu decodeaza nicio
  // imagine (vezi quickDuplicateScan) — pe o galerie fara duplicate nici macar
  // nu citeste de pe disc — deci nu ia nimic din bugetul analizei.
  void quickDuplicateScan(images.map(({ file }) => file)).then(quickScan => {
    if (quickScan.duplicates > 0) onProgress({ ...lastProgress, quickScan });
  }).catch(() => {
    // o cifra in plus care lipseste nu e un motiv sa se opreasca importul
  });

  await analysisPool.init();
  await contextEngine.init();
  const persons = await db.persons.toArray();
  await analysisPool.setKnownPersons(persons);
  // Pragurile se calculeaza O SINGURA DATA, inainte de lot, si raman fixe pe
  // toata durata lui: altfel primele poze ar fi clasificate dupa alte reguli
  // decat ultimele, iar rezultatul aceluiasi import ar depinde de ordinea
  // fisierelor. Vezi core/scoreThresholds.ts.
  // ...si peste ele, severitatea aleasa de utilizator (implicit 'balanced', care
  // nu schimba nimic) — vezi applyStrictness si state/cullingStrictness.ts.
  const thresholds = applyStrictness(deriveThresholds(await readLibraryScores()), readCullingStrictness());
  if (thresholds.adapted) onProgress({ done: 0, total: files.length, fileName: '', phase: 'incarcare', thresholds });

  // Cerinta directa a utilizatorului: la un import mare, pozele cu oameni sa
  // fie gata de triat primele — vezi comentariul de la prioritizeFacesFirst
  // (doar Android, no-op si instant pe web/PWA).
  images = await prioritizeFacesFirst(images, (done, total) =>
    onProgress({ done, total, fileName: '', phase: 'pregatire' })
  );

  const concurrency = analysisPool.size + 1;
  let done = 0;
  let index = 0;
  let failed = 0;

  let stopReason: string | undefined;
  const hashes: HashInput[] = [];
  // Motivele reale (distincte) ale esecurilor — altfel "fisier corupt sau
  // format neasteptat" e un mesaj generic care nu spune nimic despre CE
  // anume a esuat (memorie, decodare, worker etc.), imposibil de diagnosticat
  // de la distanta fara acces la consola browserului utilizatorului.
  const failureReasons = new Map<string, number>();

  const stopMessage = (n: number) =>
    `Spatiu de stocare aproape plin — import oprit la ${n}/${images.length}. ` +
    `Exporta ce ai deja sau elibereaza spatiu (Goleste sesiunea / sterge pozele respinse) ca sa continui.`;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        if (stopReason) break;
        if (cancelToken?.cancelled) { stopReason = `Import anulat — ${done}/${images.length} poze procesate pana la anulare.`; break; }
        const myIndex = index++;
        if (myIndex >= images.length) break;
        const { file, handle, mediaUri } = images[myIndex];

        try {
          const item = await processOne(file, genre, project, handle, mediaUri, thresholds, mediaUri ? mediaLocations?.get(mediaUri) : undefined);
          hashes.push(toHashInput(item.photo.id, item.photo.dHash, item.analysis, item.photo.capturedAt));
          onPhoto(item);
        } catch (err) {
          if (isQuotaError(err)) { stopReason = stopMessage(done); break; }
          console.error('Analiza a esuat pentru ' + file.name + ':', err);
          failed++;
          let reason = err instanceof Error ? (err.name + ': ' + err.message) : String(err);
          const realFormat = await sniffRealFormat(file);
          if (realFormat) reason += ` [fisier real: ${realFormat}, etichetat "${file.type || file.name}"]`;
          failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
        }
        done++;
        onProgress({ done, total: images.length, fileName: file.name, phase: 'analiza' });
      }
    })
  );

  // Grupare serii/duplicate (dHash), PERSISTATA in DB: cea mai buna ramane propusa,
  // restul trec la "review" ca variante de comparat. Comparatia O(n^2) ruleaza
  // intr-un Worker dedicat (hashCompare.worker.ts), procesata in chunk-uri —
  // pentru 1000+ poze, milioane de comparatii sincrone pe firul principal
  // blocau vizibil UI-ul in acest punct al importului.
  onProgress({ done, total: images.length, fileName: '', phase: 'grupare' });
  // Gruparea e masurata ca UN SINGUR bloc, nu per poza: costul ei e O(n^2) in
  // marimea bibliotecii, deci "cat a durat pe tot lotul" e singura cifra care
  // spune ceva. Vezi core/stageTiming.ts.
  const groupingStart = performance.now();
  const groups = new Map<string, string>();

  // Procesare incrementala (plan 2.3.3): comparam si cu poze NEGRUPATE dintr-un
  // import ANTERIOR (acelasi eveniment, importat in doua sesiuni separate) — fara
  // asta, un duplicat/serie intre doua importuri distincte nu era niciodata
  // detectat, doar cele din ACEEASI trecere de import. Pozele deja grupate (dintr-o
  // serie deja rezolvata) raman intentionat NEATINSE: nu le re-includem, ca sa nu
  // "relitigam" o decizie deja luata la un import complet nelegat.
  const currentBatchIds = new Set(hashes.map(h => h.id));
  // index-backed (vezi db.ts v6): groupId e mereu '' pentru poze negrupate,
  // niciodata absent, deci where().equals('') foloseste indexul in loc sa
  // scaneze toata tabela — cost independent de marimea bibliotecii.
  const existingUngrouped = (await db.photos.where('groupId').equals('').toArray())
    .filter(p => !currentBatchIds.has(p.id));
  let existingHashes: HashInput[] = [];
  if (existingUngrouped.length) {
    const analyses = await db.analyses.bulkGet(existingUngrouped.map(p => p.id));
    existingHashes = existingUngrouped
      .map((p, i) => { const a = analyses[i]; return a ? toHashInput(p.id, p.dHash, a, p.capturedAt) : null; })
      .filter((h): h is HashInput => h !== null);
  }

  // Alegerea celui mai bun cadru din serie tine cont si de ce a invatat motorul
  // din deciziile utilizatorului, proportional cu cat de antrenat e — vezi
  // groupScore in core/groupSelection.ts.
  const { groups: groupResults } = await groupPhotosByHash(
    [...hashes, ...existingHashes], undefined, await contextEngine.learnedWeight()
  );
  // Bug real gasit de auditul QA (bug/low-medium): bucla de mai jos facea, per
  // membru de grup, un db.photos.get() (pentru membrii non-best) urmat de un
  // db.photos.update() — pentru un import de 1000 de poze cu multe burst-uri
  // (exact cazul sport/nunta/eveniment tintit de aplicatie), sute-pana-la-o mie
  // de round-trip-uri IndexedDB SECVENTIALE, chiar dupa faza deja costisitoare
  // de analiza AI. Inlocuit cu un singur bulkGet + un singur bulkPut.
  const allMemberIds = groupResults.flatMap(g => g.memberIds);
  const memberRecords = await db.photos.bulkGet(allMemberIds);
  const recordById = new Map<string, PhotoRecord>();
  allMemberIds.forEach((id, i) => { const rec = memberRecords[i]; if (rec) recordById.set(id, rec); });

  const updates: PhotoRecord[] = [];
  // Bug real gasit de auditul QA (storage): un membru demovat aici de la
  // 'selected' la 'review' isi pastra la infinit copia FULL a fisierului
  // original in db.originals/db.fileHandles — syncOriginal() (store.ts) e
  // singurul loc care sterge acele randuri, dar acest bulkPut o ocoleste
  // complet. Pe un burst de N poze unde mai multe trec initial pragul de
  // auto-selectare (fiecare scrie deja originalul in processOne), gruparea de
  // mai jos demoveaza N-1 dintre ele fara sa le mai stearga vreodata copia —
  // exact cazul burst/eveniment tintit de aplicatie, unde efectul se
  // multiplica cu marimea burst-ului.
  const demotedIds: string[] = [];
  for (const g of groupResults) {
    // Cine trebuie salvat de la disparitia intregii clipe — calculat INAINTE de
    // bucla, pe starile de dinaintea oricarei schimbari. Vezi core/momentRescue.ts.
    const rescuedId = rescueBestOfMoment(
      g.memberIds.map(id => {
        const rec = recordById.get(id);
        return { id, status: rec ? rec.status : 'pending' };
      }),
      g.bestId
    );
    for (const memberId of g.memberIds) {
      groups.set(memberId, g.groupId);
      const rec = recordById.get(memberId);
      if (!rec) continue;
      const next: PhotoRecord = { ...rec, groupId: g.groupId };
      if (memberId !== g.bestId && rec.status === 'selected') {
        next.status = 'review';
        demotedIds.push(memberId);
      }
      if (memberId === rescuedId) next.status = 'review';
      updates.push(next);
    }
  }
  if (updates.length) await db.photos.bulkPut(updates);
  record('grouping', performance.now() - groupingStart);
  if (demotedIds.length) {
    await Promise.all(demotedIds.map(id => Promise.all([db.originals.delete(id), db.fileHandles.delete(id)])));
  }

  // Fara acest avertisment, un import in care TOATE pozele esueaza la decodare
  // (fisier corupt, format neasteptat, poza cu 0 fete detectabile pe un device
  // fara accelerare etc.) se termina complet in tacere: bara de progres ajunge
  // la 100%, dispare, si utilizatorul ramane cu ecranul gol, fara nicio pista.
  // Includem motivul real (nume + mesaj eroare) — fara el, "format neasteptat"
  // e un mesaj generic care nu ajuta la diagnosticare de la distanta.
  const topReasons = [...failureReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, n]) => `${reason} (x${n})`)
    .join(' · ');
  const failureWarning = failed > 0
    ? (failed === images.length
        ? `Niciuna dintre cele ${images.length} poze nu a putut fi procesata.`
        : `${failed} din ${images.length} poze nu au putut fi procesate — restul au fost adaugate.`)
      + (topReasons ? ` Motiv: ${topReasons}` : '')
    : undefined;
  const skippedWarning = skippedCount > 0
    ? `${skippedCount} ${skippedCount === 1 ? 'fisier ales nu e o poza' : 'fisiere alese nu sunt poze'} `
      + `(video, HEIC etc.) — ${skippedCount === 1 ? 'a fost sarit' : 'au fost sarite'}.`
    : undefined;
  onProgress({
    done, total: images.length, fileName: '', phase: 'finalizat',
    warning: stopReason ?? failureWarning ?? skippedWarning,
    outcome: {
      // `done`, nu `images.length`: la un import anulat la 52/437, denominatorul
      // corect e ce s-a incercat, nu ce s-ar fi incercat. Altfel un import oprit
      // devreme ar raporta mereu o rata de esec aproape zero.
      total: done,
      imported: done - failed,
      failed,
      skipped: skippedCount,
      reasons: topReasons || undefined
    }
  });
  return groups;
}
