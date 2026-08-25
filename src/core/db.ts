/**
 * core/db.ts
 * Persistence layer (IndexedDB via Dexie).
 * All heavy data (thumbnails, previews, embeddings, AI metadata) lives here, NOT in RAM.
 */
import Dexie, { type Table } from 'dexie';
import type { EditAdjustments } from './imageAdjust';

// ── Domain types ─────────────────────────────────────────────────────────────

/**
 * Starea unei poze in triaj.
 *
 * `candidate` e o decizie A OMULUI, nu a motorului, si de asta e distincta de
 * `review`: acolo AI-ul spune "nu stiu, uita-te tu", aici omul spune "o tin
 * deoparte". Opreste alegerea falsa dintre "pastrez" si "arunc" — cadrul
 * afectiv sau comercial pe care nu vrei sa-l pierzi, dar nici nu-l dai inca
 * mai departe. Nicio operatie automata nu are voie sa-l atinga.
 *
 * Alias exportat ca sa nu mai fie repetat in fiecare modul care primeste o
 * forma minimala de poza — exact locurile care ramaneau in urma la fiecare
 * stare noua.
 */
export type PhotoStatus = 'pending' | 'selected' | 'candidate' | 'rejected' | 'review';

export interface PhotoRecord {
  id: string;
  fileName: string;
  capturedAt?: number;
  importedAt: number;
  width: number;
  height: number;
  dHash: string;
  groupId?: string;         // seria/duplicatele din care face parte
  status: PhotoStatus;
  /**
   * Dimensiunea fisierului original (bytes, din File.size la import) — plan
   * modernizare, ecranul Acasa: singurul mod REAL de a arata "X GB ocupate"/
   * "eliberezi Y GB" fara sa ghicim. Optional: absent la poze importate
   * inainte de acest camp (biblioteci vechi) — codul care il citeste trebuie
   * sa trateze absenta separat de 0, nu presupune. Nu necesita bump de schema
   * Dexie (camp neindexat, la fel ca `rating`/`genre`/`project` de mai sus).
   */
  sizeBytes?: number;
  /**
   * Rating 1-5 stele, independent de status (ca in Lightroom: flag-ul
   * pick/reject si rating-ul sunt axe separate — o poza poate fi Selectata
   * SI 3 stele, sau De verificat fara nicio stea). Optional/0/absent = fara
   * rating; nu necesita bump de schema Dexie (camp neindexat, filtrat client-side).
   */
  rating?: number;
  /**
   * Genul fotografic activ la momentul importului ("Nunta", "Portret", ...),
   * ales de utilizator inainte de import — vezi state/genre.ts. Prefixeaza
   * contextKey (ContextEngine.deriveContextKey), astfel incat modelul de
   * preferinte invatat pentru "Nunta:portrait:known" sa fie complet separat
   * de "Peisaj:landscape". Pastrat PE POZA (nu doar ca setare globala curenta)
   * ca schimbarea genului activ ulterior sa nu "mute" retroactiv contextul
   * unei corectii deja inregistrate. Optional: absent = fara gen ales
   * (comportament identic cu inainte de aceasta functie); nu necesita bump
   * de schema Dexie (camp neindexat, filtrat/citit client-side).
   */
  genre?: string;
  /**
   * Numele proiectului/sesiunii activ la momentul importului (ProjectNameField
   * din App.tsx, PhotoRecord distinct de `genre` — un proiect ("Nunta Ana & Mihai")
   * poate contine mai multe genuri, desi de obicei coincid). Pastrat PE POZA, nu
   * doar ca eticheta curenta, ca "Modulul Proiecte" (plan 3.2.3) sa poata agrega
   * retroactiv istoricul real de import per proiect. Optional: absent = fara
   * proiect ales; nu necesita bump de schema Dexie (camp neindexat).
   */
  project?: string;
  /**
   * Eticheta de culoare (Lightroom-style color label) — a DOUA axa de
   * organizare libera, independenta de status/rating (ex. "rosu" = de
   * retusat, "albastru" = trimis clientului deja). Absent sau 'none' = fara
   * eticheta; nu necesita bump de schema Dexie (camp neindexat, filtrat
   * client-side, exact ca `rating`/`genre`/`project` de mai sus).
   */
  colorLabel?: ColorLabel;
  /**
   * Suprascriere manuala a descrierii/cuvintelor-cheie IPTC (editare in masa,
   * plan "modernizare") — precede iptcCaption/iptcKeywords PARSATE din fisier
   * (AnalysisRecord, vezi core/iptcParser.ts) cand e setata, fara sa le
   * modifice pe cele originale. Absent = foloseste in continuare valorile
   * parsate din fisier; nu necesita bump de schema Dexie (camp neindexat,
   * exact ca `colorLabel`/`rating`/`genre` de mai sus).
   */
  captionOverride?: string;
  keywordsOverride?: string[];
  /**
   * Placeholder minuscul (JPEG ~16px lat, incarcat direct ca data: URI) generat la
   * import alaturi de miniatura reala — afisat instant, blurat, cat timp miniatura
   * din db.thumbnails se incarca asincron (fetch separat, alt "tabel"). Cateva sute
   * de octeti; stocat direct pe PhotoRecord (nu blob separat) tocmai ca sa fie
   * disponibil SINCRON din PhotoView, fara alt round-trip async la primul randare.
   * Optional: absent pe inregistrari importate inainte de aceasta functie.
   */
  lqip?: string;
  /**
   * Ajustari de baza non-destructive (expunere/contrast/saturatie/temperatura/
   * tinta/highlights/shadows) — vezi core/imageAdjust.ts. Absent sau toate
   * valorile 0 = fara nicio ajustare (fotografia ramane exact ca la import);
   * nu necesita bump de schema Dexie (camp neindexat, exact ca lqip/colorLabel
   * de mai sus). Originalul si preview-ul/miniatura stocate NU sunt modificate
   * niciodata — ajustarile se aplica live, la cerere, pe un canvas separat.
   */
  edits?: EditAdjustments;
  /**
   * Alegerea clientului ('galerie client cu feedback', vezi core/export/clientGallery.ts
   * + core/export/clientFeedback.ts) — importata din JSON-ul descarcat de client din
   * galeria HTML statica trimisa de fotograf, potrivita pe `id` (fallback `fileName`).
   * Distinct de `status`/`rating` (deciziile FOTOGRAFULUI): un client poate aprecia o
   * poza pe care fotograful a respins-o, si invers — ambele axe raman vizibile separat.
   * Absent = niciun feedback de client importat inca; nu necesita bump de schema Dexie
   * (camp neindexat, exact ca `colorLabel`/`rating`/`genre` de mai sus).
   */
  clientFeedback?: 'like' | 'dislike';
  /**
   * URI content:// nativ Android al fisierului original (MediaLibraryPlugin.kt,
   * ACTION_OPEN_DOCUMENT cu permisiune persistenta) — spre deosebire de
   * FileHandleRecord (File System Access API, doar desktop), acesta e ce
   * permite `deleteRejectedPhotos` (state/store.ts) sa ceara stergerea de pe
   * telefon, prin dialogul de confirmare al sistemului
   * (MediaStore.createTrashRequest — tehnic Cos de gunoi, prezentata insa
   * utilizatorului ca definitiva, vezi MediaLibraryPlugin.kt). Absent pentru:
   * poze importate pe web/PWA, poze importate pe Android prin
   * <input type="file"> (plasa de siguranta, nu retine URI-ul), si orice poza
   * importata INAINTE de aceasta functie — in toate aceste cazuri, stergerea
   * ramane manuala din galerie. Nu necesita bump de schema Dexie (camp
   * neindexat, exact ca `colorLabel`/`lqip` de mai sus).
   */
  mediaUri?: string;
}

export type ColorLabel = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';
/** Toate etichetele asignabile, EXCLUZAND 'none' (care inseamna "fara eticheta", nu o culoare reala) — sursa unica pentru orice UI de asignare/filtrare. */
export const COLOR_LABELS: Exclude<ColorLabel, 'none'>[] = ['red', 'yellow', 'green', 'blue', 'purple'];

export interface ThumbnailRecord {
  photoId: string;
  blob: Blob;               // JPEG ~512px pentru grila
}

export interface PreviewRecord {
  photoId: string;
  blob: Blob;               // JPEG ~2048px pentru evaluarea claritatii (zoom 100%)
}

export interface OriginalRecord {
  photoId: string;
  blob: Blob;                // fisierul original, byte-cu-byte (pentru export "format original")
  fileName: string;
  type: string;
}

/**
 * Referinta usoara catre fisierul original de pe disc (File System Access API),
 * folosita IN LOC de OriginalRecord.blob cand browserul o suporta — un handle
 * e cateva zeci de octeti (nu MB/zeci de MB per poza), asa ca nu risca
 * QuotaExceededError pe importuri mari. FileSystemFileHandle e clonabil
 * structural in IndexedDB (Chromium); getFile()/permisiunile sunt verificate
 * la citire (vezi filePicker.ts reacquireFile).
 */
export interface FileHandleRecord {
  photoId: string;
  handle: import('./filePicker').FileSystemFileHandleLike;
}

export interface FaceInsight {
  box: [number, number, number, number];
  faceScore: number;
  smile: number;
  eyesOpen: { left: number; right: number };
  isBlinking: boolean;
  personId: string | null;
  personName: string | null;
  similarity: number;
  embedding?: number[];
  /**
   * Vectorul complet de emotie (7 clase, model FER standard) — smile ramane
   * pastrat separat pentru compatibilitate, dar engagement e derivat din
   * TOATE emotiile (happy+surprise pozitive, angry/disgust/sad/fear negative),
   * nu doar zambet. Optional: inregistrarile vechi nu au acest camp.
   */
  emotion?: { happy: number; surprise: number; neutral: number; negative: number };
  /**
   * Contact vizual estimat (0..1), din unghiul capului (yaw/pitch fata de
   * camera) + offset-ul irisului fata de centrul ochiului (Human.js
   * rotation.gaze). Foloseste doar MAGNITUDINEA acestor semnale, nu directia —
   * nu conteaza daca subiectul se uita stanga sau dreapta, doar CAT de departe
   * e de a privi direct spre camera. Optional: necesita mesh de 478 puncte
   * (iris activat) si o fata suficient de mare/clara.
   */
  eyeContact?: number;
  /**
   * Gura vizibil deschisa (Mouth Aspect Ratio geometric, din mesh — acelasi
   * principiu ca eyeOpenness/EAR pentru clipit), fara nicio judecata de
   * emotie inca. Folosit impreuna cu `emotion` ca sa deosebim un zambet larg
   * / o expresie de surpriza (dorite) de un moment "la mijlocul vorbirii"
   * sau cascat (nedorit) — vezi groupAwkwardRatio pe AnalysisRecord.
   */
  mouthOpen?: boolean;
  /**
   * Catchlight ("lumina in ochi") — un punct mic si luminos reflectat pe
   * cornee, reper clasic de portret ("privire vie" vs. ochi "stinsi"). Vezi
   * detectCatchlight in worker. Optional: absent pe inregistrari vechi
   * (dinainte de aceasta functie), tratat neutru, nu ca "fara catchlight".
   */
  catchlight?: boolean;
}

export interface AnalysisRecord {
  photoId: string;
  faces: FaceInsight[];
  faceCount: number;
  knownFaceCount: number;
  strangerCount: number;
  bestSmile: number;
  allEyesOpen: boolean;
  sharpness: number;
  exposure: number;
  sceneType: 'portrait' | 'group' | 'landscape' | 'detail';
  aiScore: number;
  analyzedAt: number;
  /**
   * Compozitie, calculata geometric din pozitia subiectului principal (fata
   * cea mai mare) fata de cadru — 0..1, 1 = aliniere ideala. Optionale: pozele
   * fara fete nu au subiect detectabil, iar inregistrarile mai vechi (dinainte
   * de aceasta functie) nu le au deloc — extractFeatures (ContextEngine)
   * trateaza absenta ca neutru (0.5), nu ca zero.
   */
  ruleOfThirds?: number;   // regula treimilor: cat de aproape e centrul fetei de o intersectie de treimi
  headroom?: number;       // spatiul deasupra capului: 0 = fata lipita de margine, 1 = in zona ideala
  /** topFactors din predictia ContextEngine la momentul importului — "de ce" a primit poza acest scor. */
  aiFactors?: { feature: string; contribution: number }[];
  /**
   * Cat de putin se poate baza cineva pe `aiScore` PENTRU ACEASTA POZA — vezi
   * uncertaintyOf() in learning/ContextEngine.ts. 0 = raspuns limpede, 1 =
   * motorul chiar nu stie. Optional: inregistrarile de dinaintea acestei
   * functii nu-l au, iar apelantii trateaza absenta ca "nu se stie", nu ca 0.
   */
  aiUncertainty?: number;
  /**
   * Cat din `aiScore` vine din gustul utilizatorului si nu din regulile
   * generale de fotografie — vezi Prediction.personalDelta. -100..100.
   * Optional: inregistrarile de dinaintea acestei functii nu-l au.
   */
  aiPersonalDelta?: number;
  /**
   * Scorare de GRUP (toate fetele, nu doar cea mai buna) — problema clasica la
   * poze cu mai multe persoane: mereu cineva clipeste. 0..1, fractiunea de fete
   * cu ochii deschisi / care zambesc. Optional: doar cand faceCount > 0.
   */
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
  /**
   * Fractiunea de fete cu o expresie "stanjenitoare" — gura vizibil deschisa
   * (mouthOpen) FARA sa fie explicata de un zambet sau o surpriza reala
   * (emotion.happy/surprise scazute): tipic un moment prins "la mijlocul
   * vorbirii" sau un cascat, nu o expresie pe care fotograful si-ar dori-o
   * intr-o poza aleasa. 0..1. Optional: doar cand faceCount > 0.
   */
  groupAwkwardRatio?: number;
  /**
   * Fractiunea de fete cu un zambet AUTENTIC (marker Duchenne — zambet real +
   * ochi usor ingustati, nu doar gura care zambeste) — vezi
   * GENUINE_SMILE_EYE_THRESHOLD in worker pentru datele de calibrare reale
   * (90 de fete, diferenta mare intre grupul autentic/fortat). Complementar
   * fata de groupSmileRatio/bestSmile (care masoara CAT de mult se zambeste,
   * nu CAT de autentic e). 0..1. Optional: doar cand faceCount > 0 SI lumina
   * nu e 'hard' (lightQuality) — ochi ingustati intr-o lumina puternica/directa
   * pot insemna clipit de la soare, nu zambet, deci evitam sa facem vreo
   * afirmatie cand nu putem distinge sigur intre cele doua.
   */
  groupGenuineSmileRatio?: number;
  /**
   * Fractiunea de fete cu catchlight (vezi FaceInsight.catchlight) — un reper
   * clasic de portret profesionist ("privire vie"), independent de zambet/
   * ochi deschisi. Nu e calibrat pe date reale (spre deosebire de
   * groupGenuineSmileRatio) — pragurile din detectCatchlight sunt o
   * aproximare rezonabila de cunostinte generale de fotografie. 0..1.
   * Optional: doar cand faceCount > 0.
   */
  groupCatchlightRatio?: number;
  /**
   * Fractiunea de fete cu ten "natural" (fara cast de culoare de la un balans
   * de alb gresit) — vezi hasNaturalSkinTone in worker. Diferit de
   * colorHarmonyScore (care judeca TOATA paleta cadrului, nu specific tenul).
   * Nu e calibrat pe date reale (la fel ca groupCatchlightRatio) — banda de
   * hue folosita e un reper din literatura de skin-detection, nu o calibrare
   * proprie. 0..1. Optional: doar cand exista cel putin o fata unde tenul a
   * putut fi masurat (regiune suficient de mare/saturata).
   */
  groupSkinToneNaturalRatio?: number;
  /** Media contact-vizual (eyeContact) pe toate fetele — 0..1. Optional: doar cand faceCount > 0. */
  avgEyeContact?: number;
  /** Media "engagement" (expresie pozitiva vs negativa) pe toate fetele — 0..1. Optional: doar cand faceCount > 0. */
  avgEngagement?: number;
  /**
   * Histograma pe versiunea redusa (320px) deja calculata pentru claritate —
   * fractiune de pixeli aproape complet alb / aproape complet negru, adica
   * detaliu pierdut in highlights/shadows. 0 = fara clipping, 1 = tot cadrul.
   */
  highlightClipping?: number;
  shadowClipping?: number;
  /**
   * Inclinarea orizontului fata de linia perfect orizontala, in grade (0 =
   * perfect drept). Calculata din directia dominanta a gradientilor de margine
   * — doar pentru poze fara fete (unde compozitia geometrica pe fata principala
   * nu se aplica). Optional: absenta = nu s-a putut estima (prea putine
   * margini clare, ex. cer uniform).
   */
  horizonTiltDeg?: number;
  /**
   * Metadate EXIF reale, citite direct din octetii fisierului original
   * (core/exifParser.ts) — createImageBitmap/canvas NU expun deloc EXIF.
   * Optionale: poze fara EXIF (PNG/WebP, sau JPEG cu metadate sterse).
   */
  iso?: number;
  fNumber?: number;        // f/X (diafragma)
  exposureTime?: number;   // secunde (1/250 -> 0.004)
  focalLength?: number;    // mm
  /**
   * "Panou de informatii extins" (plan 3.2.2) — restul metadatelor EXIF utile
   * pentru camera/obiectiv/locatie, dincolo de campurile de mai sus (folosite
   * direct pentru scorare). Vezi core/exifParser.ts pentru ce anume citesc.
   */
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  exifSoftware?: string;
  exifArtist?: string;
  exifCopyright?: string;
  exposureBias?: number;
  meteringMode?: string;
  flashFired?: boolean;
  whiteBalance?: 'auto' | 'manual';
  focalLength35mm?: number;
  /** Eroarea de pozitionare declarata de aparat, in metri — vezi core/exifParser.ts. */
  gpsAccuracyM?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;

  /**
   * Metadate IPTC-IIM (segment Photoshop APP13, distinct de EXIF/XMP) — vezi
   * core/iptcParser.ts. Multe fluxuri profesionale (agentii foto, Photo
   * Mechanic, exporturi Lightroom mai vechi) inca scriu doar IPTC-IIM.
   */
  iptcByline?: string;
  iptcCaption?: string;
  iptcHeadline?: string;
  iptcCredit?: string;
  iptcSource?: string;
  iptcCopyright?: string;
  iptcCity?: string;
  iptcCountry?: string;
  iptcKeywords?: string[];

  // ── Analiza estetica avansata ──────────────────────────────────────────
  // Toate calculate geometric/statistic direct din pixeli (Sobel, histograme
  // HSV, varianta locala) sau din campurile deja detectate (fete, EXIF) —
  // fara modele ML noi. Optionale: absente pe inregistrari mai vechi,
  // tratate ca neutre in ContextEngine (extractFeatures), nu ca zero.
  /** Scor agregat de compozitie (0..1) — combina treimile/headroom (subiect uman)
   *  sau liniile directoare/simetria/spatiul negativ (scene fara fete). */
  compositionScore?: number;
  /** Concentrare puternica a muchiilor pe directii convergente/diagonale dominante. */
  leadingLinesDetected?: boolean;
  /** Jumatatea stanga a cadrului e aproape o oglinda a celei drepte (harta de muchii). */
  symmetryDetected?: boolean;
  /** Fractiune din cadru cu detaliu local scazut (zone "goale" — cer, perete, fundal uniform), 0..1. */
  negativeSpaceScore?: number;
  /** Duritatea luminii, din distributia contrastului local (Sobel): 'hard' = umbre nete/contrast mare. */
  lightQuality?: 'soft' | 'hard' | 'mixed' | 'unknown';
  /** Nuanta calda dominanta (portocaliu/auriu) + ora capturii apropiata de rasarit/apus — semnal aproximativ. */
  goldenHourDetected?: boolean;
  /**
   * Subiectul principal e mai clar decat fundalul (claritate locala box
   * subiect vs. rest). Subiectul e fata cea mai mare cand exista fete, sau —
   * pentru poze fara oameni (macro, produs, animale) — cel mai mare obiect
   * detectat de CenterNet cu incredere rezonabila (vezi mainObjectBox in
   * worker), NU tot cadrul: la fel ca la un portret, un fundal difuz
   * (bokeh) intentionat nu trebuie sa penalizeze o poza cu subiectul clar.
   */
  subjectInFocus?: boolean;
  /** Diferenta de claritate subiect/fundal, calitativa — 'n/a' cand nu exista niciun subiect (fata sau obiect) de comparat. */
  bokehQuality?: 'good' | 'average' | 'poor' | 'n/a';
  /** Armonia paletei de culori (0..1) — complementara/analoaga = scor mare, culori dezordonate = scor mic. */
  colorHarmonyScore?: number;
  /** Cele mai frecvente 3 culori din cadru (cuantizate), format hex — pentru afisare/paleta. */
  dominantColors?: string[];
  /** Eticheta compusa din tipul de scena + varsta estimata a subiectului principal (cand e disponibila). */
  sceneSemantic?: string;
  /**
   * Etichete generale de obiect/scena (ex. "seashore", "golden retriever", "mountain bike"),
   * dintr-un clasificator ImageNet generic (MobileNetV2) — spre deosebire de sceneSemantic
   * (derivat din fetele detectate), acestea functioneaza si pe cadre fara oameni. Optionale:
   * absente daca modelul de clasificare nu s-a putut incarca (degradare graduala, ca
   * aiDegraded) sau pe inregistrari dinaintea acestei functii.
   */
  sceneTags?: string[];
  /**
   * Fractiune din cadru acoperita de text detectat (OCR) — 0..1, aproximare
   * (suma ariilor cutiilor de text, nu o uniune reala). Doar pe Android nativ
   * (core/nativeAnalysis.ts, plugin-ul TextRecognition), calculat DOAR cand
   * fotografia nu are nici fete nici sceneTags — semnal pentru
   * importPipeline.ts:hasNoRecognizableSubject ca sa prinda documente/
   * capturi de ecran care altfel ar trece drept "fara subiect recognoscibil"
   * fara sa fie marcate distinct. Absent pe web/PWA (pipeline-ul JS nu are OCR).
   */
  textCoverage?: number;
  /**
   * Embedding general de similaritate vizuala (continut, NU identitate) —
   * MediaPipe Image Embedder + MobileNetV3-small (core/nativeImageEmbedder.ts).
   * Doar Android nativ, si doar cand faceCount === 0: pentru poze CU fete,
   * embedding-urile faciale (FaceInsight.embedding) sunt deja semnalul
   * puternic folosit de hashCompare.worker.ts la rafinarea seriilor/duplicatelor;
   * acesta acopera exact golul ramas — rafale FARA oameni (peisaje, animale),
   * care altfel cad pe un semnal mult mai slab (compozitie/armonie culori).
   */
  imageEmbedding?: number[];
  /**
   * true daca cel putin o persoana detectata (MediaPipe Pose Landmarker,
   * core/nativePoseDetection.ts) pare sa aiba o extremitate (mana/incheietura
   * sau picior/glezna) taiata de marginea cadrului — landmark aproape de
   * margine SI cu incredere de vizibilitate scazuta (MediaPipe extrapoleaza
   * punctele din afara cadrului, cu incredere redusa). Doar Android nativ, si
   * doar cand faceCount > 0 (fara consumator pentru poze fara oameni). NU
   * verificat pe un set mare de poze reale — o prima aproximare rezonabila,
   * de recalibrat daca la testare pe device se dovedeste prea sensibila/insensibila.
   */
  bodyCroppedAtEdge?: boolean;
}

/**
 * Folder personalizat (cerinta directa a utilizatorului: "sa am posibilitatea
 * sa creez foldere, sa le denumesc si sa pun anumite poze in ele") — distinct
 * de folderLabel (core/exportPhotos.ts), care deriva automat un folder din
 * persoane/scena la export. Aici utilizatorul decide EXPLICIT numele si
 * apartenenta, independent de orice semnal AI. Apartenenta traieste pe
 * `memberIds` (nu pe PhotoRecord) — o poza poate fi in mai multe foldere
 * simultan (N:M), fara sa atinga deloc schema tabelei `photos`.
 */
export interface CollectionRecord {
  id: string;
  name: string;
  createdAt: number;
  memberIds: string[];
  /**
   * "Dosar privat" (plan modernizare, core/vault.ts) — un singur folder cu
   * acest flag exista per biblioteca (getOrCreateVaultCollection), filtrat
   * explicit din Albume/selectorul de foldere si din grila principala cat
   * timp nu e deblocat cu PIN in sesiunea curenta. Absent/false = folder
   * normal, vizibil mereu (comportament neschimbat); nu necesita bump de
   * schema Dexie (camp neindexat, exact ca restul campurilor optionale din
   * PhotoRecord de mai sus).
   */
  isPrivate?: boolean;
}

export interface KnownPerson {
  id: string;
  name: string;
  embeddings: number[][];
  updatedAt: number;
  /**
   * Cand a fost inrolata prima data. Separat de `updatedAt`, care se muta la
   * fiecare referinta adaugata — vezi core/activePersons.ts, unde ordinea de
   * inrolare decide cine ramane activ fara abonament. Absent pe inregistrarile
   * de dinainte de camp: acolo se cade pe `updatedAt`, fara migrare.
   */
  enrolledAt?: number;
}

export interface ContextModelRecord {
  contextKey: string;
  weights: Record<string, number>;
  bias: number;
  featureStats: Record<string, { mean: number; m2: number; n: number }>;
  sampleCount: number;
  updatedAt: number;
}

/**
 * "Cu ce seamana pozele pe care le pastrezi" — doua centroide (medii) peste
 * embedding-urile de continut ale pozelor pastrate, respectiv respinse.
 *
 * De ce exista: embedding-ul de 1024 de dimensiuni (AnalysisRecord.imageEmbedding)
 * se calculeaza deja pentru fiecare poza fara fete, dar era folosit EXCLUSIV la
 * detectia de duplicate (hashCompare.worker.ts) — un semnal semantic complet
 * platit si complet ignorat la scorare. Cu el, motorul poate invata ce fel de
 * CONTINUT tii (peisaje de munte, animalul tau, mancare) si ce arunci
 * (capturi de ecran, poze de pereti), nu doar cat de clara/expusa e poza.
 *
 * Un singur rand ('current'). Medie incrementala, deci costul e O(1) per
 * decizie si nu tine minte nicio poza individuala — doar directia generala.
 */
export interface EmbeddingMemoryRecord {
  id: 'current';
  /** Suma embedding-urilor pastrate (impartita la keptCount da centroida). */
  keptSum: number[];
  keptCount: number;
  rejectedSum: number[];
  rejectedCount: number;
  updatedAt: number;
}

/**
 * Ce SUBIECTE pastrezi si ce arunci, dupa etichetele de scena — vezi
 * learning/tagMemory.ts. Distinct de EmbeddingMemoryRecord fiindca etichetele
 * exista la ORICE poza, iar embedding-ul de continut doar la pozele fara fete.
 *
 * Un singur rand ('current'). Doar numaratori — nicio poza nu e retinuta.
 */
export interface TagMemoryRecord {
  id: 'current';
  /** eticheta -> de cate ori a aparut pe o poza pastrata / respinsa */
  tags: Record<string, { kept: number; rejected: number }>;
  keptTotal: number;
  rejectedTotal: number;
  updatedAt: number;
}

export interface CorrectionRecord {
  id?: number;
  photoId: string;
  contextKey: string;
  features: Record<string, number>;
  aiDecision: boolean;
  userDecision: boolean;
  ts: number;
}

/**
 * Istoric de decizii MANUALE (Selecteaza/Respinge), pentru undo — separat de
 * CorrectionRecord (care alimenteaza ContextEngine si NU e revertit la undo:
 * a "de-antrena" corect un pas de gradient online nu e o operatie sigura/
 * curata, iar impactul unui singur pas e oricum mic; undo aici inseamna doar
 * "arata-mi din nou ce am vazut inainte de decizie", nu "sterge ce a invatat
 * modelul din ea").
 */
export interface HistoryRecord {
  id?: number;
  photoId: string;
  previousStatus: PhotoRecord['status'];
  newStatus: PhotoRecord['status'];
  ts: number;
}

// ── Database ─────────────────────────────────────────────────────────────────

export class LuminDB extends Dexie {
  photos!: Table<PhotoRecord, string>;
  thumbnails!: Table<ThumbnailRecord, string>;
  previews!: Table<PreviewRecord, string>;
  originals!: Table<OriginalRecord, string>;
  fileHandles!: Table<FileHandleRecord, string>;
  analyses!: Table<AnalysisRecord, string>;
  persons!: Table<KnownPerson, string>;
  contextModels!: Table<ContextModelRecord, string>;
  embeddingMemory!: Table<EmbeddingMemoryRecord, string>;
  tagMemory!: Table<TagMemoryRecord, string>;
  corrections!: Table<CorrectionRecord, number>;
  history!: Table<HistoryRecord, number>;
  collections!: Table<CollectionRecord, string>;

  constructor() {
    super('lumin-culler-v2');
    this.version(1).stores({
      photos: 'id, capturedAt, status, dHash',
      thumbnails: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
    this.version(2).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
    // v3: pastram fisierul original doar pentru pozele SELECTATE (nu toate cele
    // 1000+ importate) — suficient ca exportul "format original" sa supravietuiasca
    // unui reload de tab (frecvent pe mobil, cand browserul descarca tab-urile
    // puse in fundal), fara sa dublam spatiul ocupat de intregul import.
    this.version(3).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts'
    });
    // v4: istoric de decizii pentru undo ("Anuleaza ultimele 10 decizii") —
    // tabela noua, nu doar campuri adaugate, deci necesita bump de versiune.
    this.version(4).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    });
    // v5: handle-uri File System Access API pentru fisierele originale (plan
    // 2.3.4) — tabela noua, separata de `originals` (care ramane blob-ul
    // complet, fallback pentru browserele fara suport pentru API).
    this.version(5).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    });
    // v6: NU schimba schema (groupId era deja indexat inca din v2) — repara doar
    // datele. Bug real gasit de auditul QA (suggestion, scalabilitate): pozele
    // fara serie/duplicat nu primeau NICIODATA campul groupId (ramanea complet
    // absent, nu doar gol) — IndexedDB exclude din index orice inregistrare al
    // carei camp indexat lipseste, deci interogarea "poze negrupate" din
    // importPipeline.ts nu putea folosi indexul si trebuia sa scaneze intreaga
    // tabela (db.photos.filter(), nu db.photos.where()) la FIECARE import, cost
    // care creste cu marimea totala a bibliotecii, nu doar cu lotul curent.
    // Migrarea de mai jos scrie explicit groupId: '' (sir gol, nu undefined)
    // pentru orice poza negrupata deja existenta — acopera indexul si pentru
    // datele vechi, o singura data, la upgrade. '' ramane falsy identic cu
    // undefined pentru tot codul existent (verificat: fiecare loc din aplicatie
    // testeaza `if (p.groupId)`/`!p.groupId`, niciunul `=== undefined`), deci
    // comportamentul observabil nu se schimba — doar interogarea devine index-backed.
    this.version(6).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts'
    }).upgrade(async tx => {
      await tx.table<PhotoRecord, string>('photos')
        .filter(p => p.groupId === undefined)
        .modify({ groupId: '' });
    });
    // v7: foldere personalizate (CollectionRecord) — tabela noua, vezi comentariul
    // de langa interfata mai sus. Apartenenta traieste pe memberIds, nu pe
    // PhotoRecord, deci restul tabelelor raman neschimbate.
    this.version(7).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts',
      collections: 'id, name'
    });

    // v8: tabela noua pentru memoria de continut (vezi EmbeddingMemoryRecord).
    // Migrare pur aditiva — Dexie creeaza tabela goala, nu atinge nimic existent.
    this.version(8).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts',
      collections: 'id, name',
      embeddingMemory: 'id'
    });

    // v9: memoria de subiecte, dupa etichetele de scena (vezi TagMemoryRecord).
    // Tot aditiva, ca v8.
    this.version(9).stores({
      photos: 'id, capturedAt, status, dHash, groupId',
      thumbnails: 'photoId',
      previews: 'photoId',
      originals: 'photoId',
      fileHandles: 'photoId',
      analyses: 'photoId, sceneType, aiScore',
      persons: 'id, name',
      contextModels: 'contextKey',
      corrections: '++id, contextKey, ts',
      history: '++id, ts',
      collections: 'id, name',
      embeddingMemory: 'id',
      tagMemory: 'id'
    });
  }
}

export const db = new LuminDB();
