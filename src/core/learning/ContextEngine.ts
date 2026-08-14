/**
 * core/learning/ContextEngine.ts
 *
 * The evolution of the old `Learner` IIFE into a real service.
 *
 * Design:
 *  - One online logistic-regression model PER CONTEXT ("portrait:known",
 *    "landscape", "group:mixed", ...), so the engine can learn things like:
 *    "user prefers slightly under-exposed dramatic portraits, but bright,
 *    razor-sharp landscapes" — the exact scenario the old global-weights
 *    Learner could never represent.
 *  - Online SGD with adaptive learning rate (lr / sqrt(n)) and L2 regularization.
 *  - Feature normalization via Welford running mean/variance per context, so
 *    weights are comparable and training is stable regardless of feature scale.
 *  - Every state mutation is persisted to IndexedDB (Dexie) — survives reloads,
 *    works offline, zero RAM pressure.
 *  - Pure TypeScript, no DOM access → can also run inside a worker if needed.
 */

import { db, type AnalysisRecord, type ContextModelRecord, type EmbeddingMemoryRecord, type TagMemoryRecord } from '../db';
import { affinity, readEmbeddingMemory, recordEmbeddingDecision, resetEmbeddingMemory } from './embeddingMemory';
import { tagAffinity, readTagMemory, recordTagDecision, resetTagMemory } from './tagMemory';
import { hasProminentFace, subjectProminence } from '../subjectProminence';
import { t, type Locale } from '../../i18n';

// ── Types ────────────────────────────────────────────────────────────────────

export type FeatureVector = Record<string, number>;

export interface Prediction {
  score: number;          // 0..100, calibrated probability * 100
  probability: number;    // 0..1 P(user selects this photo)
  contextKey: string;
  confidence: 'cold' | 'warming' | 'trained';  // based on sampleCount
  topFactors: { feature: string; contribution: number }[];
}

export interface CorrectionInput {
  photoId: string;
  analysis: AnalysisRecord;
  aiDecision: boolean;    // what the AI recommended
  userDecision: boolean;  // what the user actually chose
  /** Genul fotografic activ pentru aceasta poza (PhotoRecord.genre) — vezi deriveContextKey. */
  genre?: string;
  /** Doar pentru textul lui topShift (vezi recordCorrection) — 'ro' implicit, ca la summarize(). */
  locale?: Locale;
}

/** O singura schimbare de pondere, suficient de mare cat sa merite anuntata utilizatorului imediat — vezi recordCorrection. */
export interface WeightShift {
  feature: string;
  label: string;
}

interface FeatureStat { mean: number; m2: number; n: number }

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_LR = 0.35;
/**
 * Puterea termenului de regularizare — cat de tare sunt trase ponderile inapoi
 * spre ANCORA lor (vezi priorAnchor() si updateWeight()), nu spre zero.
 *
 * Era 0.002 si trage spre 0. Efectul, pe termen lung, era exact invers fata de
 * ce trebuie: un feature care apare la fiecare poza (claritatea, expunerea)
 * primeste sute de pasi de antrenare, iar fiecare pas ii mai musca din pondere
 * cate lr*L2*w INDIFERENT daca utilizatorul a confirmat sau nu ceva despre el.
 * Cu destule decizii, cunostintele fotografice puse cu mana in PRIOR_WEIGHTS
 * (claritate 0.9, ochi deschisi 0.8, zambet 0.7...) se erodau lent spre zero,
 * si motorul ajungea sa stie MAI PUTIN dupa ce invata decat stia din prima poza.
 *
 * Acum termenul trage spre prior: deviatia de la cunostintele de baza trebuie
 * re-justificata continuu de date reale. Un utilizator care chiar prefera altceva
 * (impinge constant in aceeasi directie) isi muta ponderea si o tine acolo;
 * o serie de decizii intamplatoare se stinge inapoi in prior. Valoarea e
 * deliberat mica in raport cu gradientul (pas tipic de gradient ~0.05-0.15,
 * revenire ~0.001 x deviatie per pas): pe termen scurt nu franeaza invatarea,
 * pe termen lung — cateva sute de decizii — recupereaza deviatia nesustinuta.
 */
const L2_LAMBDA = 0.02;
const MAX_ABS_WEIGHT = 4.0;
/**
 * Cat de departe de ancora poate ajunge o pondere invatata. Motorul de baza
 * ramane baza: autoinvatarea are voie sa ADAPTEZE stilul (o pondere de 0.9 poate
 * ajunge oriunde intre -0.6 si 2.4), nu sa inverseze complet cunostintele
 * fotografice pe baza catorva zeci de decizii. Fara acest plafon, MAX_ABS_WEIGHT
 * (±4) lasa teoretic "claritatea" sa devina puternic NEGATIVA — adica "prefer
 * pozele neclare" — dintr-o serie nefericita de corectii corelate (o sesiune
 * intreaga de poze de concert, toate neclare, toate pastrate).
 */
const MAX_PRIOR_DEVIATION = 1.5;
const COLD_START_SAMPLES = 8;
const TRAINED_SAMPLES = 40;
/** Acelasi prag ca explainFactors() ("contributii neglijabile") — o schimbare de pondere sub asta nu merita un toast "Am invatat". */
const PREF_SHIFT_THRESHOLD = 0.03;

/**
 * Model "backbone": antrenat pe FIECARE corectie, indiferent de context —
 * spre deosebire de modelele per-context (izolate intre ele), acesta acumuleaza
 * semnal din toate genurile/scenele deodata, deci devine util mult mai repede
 * (N mare = toate corectiile utilizatorului, nu doar cele dintr-un singur
 * context). predict() il foloseste ca "memorie" mai ampla pentru contextele
 * noi/rar intalnite (shrinkage catre backbone cand sampleCount per-context e
 * mic), in loc sa porneasca mereu doar de la PRIOR_WEIGHTS static — vezi
 * blendWithGlobal(). Cheia e imposibil de generat de deriveContextKey (care
 * produce mereu "[gen:]sceneType[:subiect]").
 */
const GLOBAL_CONTEXT_KEY = '__global__';
/** La sampleCount == GLOBAL_BLEND_K, context si backbone au pondere egala (50/50) in predictie. */
const GLOBAL_BLEND_K = 12;

/** Sensible priors so the engine is useful before any correction exists. */
const PRIOR_WEIGHTS: FeatureVector = {
  sharpness: 0.9,
  exposureBalance: 0.5,
  bestSmile: 0.7,
  allEyesOpen: 0.8,
  knownFaceRatio: 0.6,
  strangerPenalty: -0.5,
  faceScore: 0.4,
  faceCount: 0.1,
  // cat de mare e omul in cadru (vezi subjectProminence) — bonus pozitiv
  // rezonabil: o fata mare e aproape mereu intentia fotografiei, una minuscula
  // e de obicei un trecator. Sub sharpness/allEyesOpen: un portret bine
  // incadrat, dar neclar sau cu ochii inchisi, tot nu e o poza buna.
  subjectProminence: 0.45,
  // compozitie (regula treimilor, headroom) — bonus modest, nu domina claritatea/expunerea/ochii
  ruleOfThirds: 0.3,
  headroom: 0.25,
  // scorare de GRUP (toate fetele, nu doar cea mai buna/stricta) — ponderi mai
  // mici decat allEyesOpen/bestSmile pentru ca la o singura fata sunt identice
  // cu acestea (redundante); la poze de grup aduc semnal suplimentar real
  groupEyesOpenRatio: 0.5,
  groupSmileRatio: 0.4,
  // "defect": fractiune de fete cu o expresie stanjenitoare (gura deschisa
  // fara zambet/surpriza reala) — vezi isAwkwardExpression in worker.
  // Pondere negativa modesta, in acelasi spirit ca strangerPenalty/clipping.
  groupAwkwardRatio: -0.3,
  // "defect": o extremitate (mana/picior) pare taiata de marginea cadrului —
  // vezi hasAwkwardBodyCrop in nativeAnalysis.ts (doar Android nativ, NEVERIFICAT
  // pe date reale). Pondere negativa modesta, acelasi spirit ca groupAwkwardRatio.
  bodyCroppedAtEdge: -0.3,
  // zambet AUTENTIC (nu doar "cat de mult zambeste") — vezi worker pentru
  // datele de calibrare reale; pondere pozitiva modesta, bonus separat de
  // bestSmile/groupSmileRatio, nu inlocuieste-le.
  groupGenuineSmileRatio: 0.25,
  // catchlight — reper clasic de portret, nu calibrat pe date reale (spre
  // deosebire de groupGenuineSmileRatio) — pondere modesta, deliberat mai
  // mica decat semnalele deja validate.
  groupCatchlightRatio: 0.15,
  // balans de alb pe ten — defect tehnic real (cast de culoare), pondere
  // moderata; nici asta nu e calibrat pe date reale, dar rationamentul
  // tehnic (banda de hue din literatura de skin-detection) e mai direct
  // decat la catchlight.
  groupSkinToneNaturalRatio: 0.3,
  avgEyeContact: 0.35,
  // "seamana cu ce pastrezi" — pornit MIC deliberat: e singurul feature care nu
  // descrie o proprietate a pozei, ci o corelatie cu istoricul tau; lasam
  // motorul sa-i creasca ponderea daca chiar prezice, in loc sa-l credem din start.
  contentAffinity: 0.2,
  // Acelasi rationament ca la contentAffinity: pornit mic, isi merita ponderea.
  subjectAffinity: 0.2,
  // Text mult in cadru inseamna de obicei document/captura de ecran, nu o poza
  // pe care o tii — dar unii chiar le tin, deci pondere negativa modesta, nu o
  // condamnare.
  textCoverage: -0.3,
  // fisier fara nicio urma de aparat foto — capturi de ecran, meme-uri, imagini
  // primite (vezi lacksCameraMetadata). Pondere negativa mai ferma decat
  // textCoverage: acolo "mult text" chiar poate fi o poza legitima (un afis, un
  // meniu), aici lipsa completa a EXIF-ului e un semnal mai curat.
  noCameraMetadata: -0.5,
  avgEngagement: 0.3,
  highlightClipping: -0.4,
  shadowClipping: -0.3,
  horizonLevel: 0.25,
  // EXIF: doar ISO are o directie universala rezonabila (zgomot ↑ = calitate
  // tehnica ↓, in medie) — modesta, fotografii chiar aleg ISO ridicat cu buna
  // stiinta (astro, concerte). Diafragma/viteza/focala NU au o directie
  // universala (context-dependente: portret vrea diafragma deschisa, peisaj
  // vrea inchisa) — pornesc la 0, invatate DOAR din corectii reale, per context.
  isoPenalty: -0.15,
  apertureRaw: 0,
  shutterSpeedRaw: 0,
  focalLengthRaw: 0,
  flashFired: 0,
  // vezi deliberateSettings in extractFeatures — mic, si necalibrat
  deliberateSettings: 0.15,
  // analiza estetica avansata (compozitie extinsa, lumina, culoare) — vezi
  // core/db.ts (AnalysisRecord) si workers/faceAnalysis.worker.ts pentru cum
  // sunt calculate. Prioritati modeste: compozitia si focusul subiectului au
  // un consens fotografic clar (bonus pozitiv rezonabil), pe cand duritatea
  // luminii si spatiul negativ sunt preferinte pur de stil — pornesc la 0,
  // invatate DOAR din corectii reale, per context (acelasi tipar ca diafragma/
  // viteza/focala mai sus).
  compositionScore: 0.3,
  leadingLines: 0.15,
  symmetry: 0.1,
  negativeSpace: 0,
  lightHard: 0,
  lightSoft: 0,
  goldenHour: 0.2,
  subjectInFocus: 0.6,
  bokehQuality: 0.2,
  colorHarmony: 0.25
};

/**
 * Punctul spre care se intoarce o pondere in lipsa unui semnal sustinut din
 * date — cunostintele fotografice de baza pentru feature-urile care le au, 0
 * pentru cele lasate deliberat "invatate din zero" (diafragma, viteza, focala,
 * duritatea luminii, spatiul negativ: nu au o directie universala, vezi
 * comentariile din PRIOR_WEIGHTS).
 */
export function priorAnchor(feature: string): number {
  return PRIOR_WEIGHTS[feature] ?? 0;
}

/**
 * Plafoneaza o pondere invatata: banda ±MAX_PRIOR_DEVIATION in jurul ancorei,
 * intersectata cu limita absoluta ±MAX_ABS_WEIGHT. Pentru feature-urile cu
 * ancora 0 (cele fara directie universala) banda devine efectiv ±1.5, mai
 * stramta decat vechiul ±4 — dar ±4 era oricum de neatins in practica: cu
 * z-score-uri plafonate la ±3, o pondere de 1.5 aduce deja ±4.5 in logit,
 * adica sigmoida complet saturata.
 */
function clampAroundAnchor(weight: number, anchor: number): number {
  const lo = Math.max(-MAX_ABS_WEIGHT, anchor - MAX_PRIOR_DEVIATION);
  const hi = Math.min(MAX_ABS_WEIGHT, anchor + MAX_PRIOR_DEVIATION);
  return Math.max(lo, Math.min(hi, weight));
}

/**
 * Un singur pas de actualizare pentru o pondere. Exportat pentru ca regula in
 * sine — "gradient, plus revenire spre ancora" — e miezul deciziei de design
 * "motor de baza puternic, autoinvatare ca adaptare", si merita testata direct,
 * nu dedusa din capatul celalalt al unui import de sute de poze (unde efectul
 * ei se amesteca inseparabil cu invatarea reala).
 *
 * @param gradient dL/dw pentru acest feature (error * valoarea normalizata)
 */
export function updateWeight(w: number, gradient: number, lr: number, anchor: number): number {
  const next = clampAroundAnchor(w - lr * (gradient + L2_LAMBDA * (w - anchor)), anchor);
  // Auto-vindecare: clampAroundAnchor foloseste Math.max/Math.min, iar
  // ambele intorc NaN cand primesc NaN — deci o pondere ajunsa cumva
  // ne-finita (model restaurat dintr-un backup editat/trunchiat, pe care
  // backupService.restoreBackup il scrie verbatim cu bulkPut, fara nicio
  // validare) ramanea NaN PENTRU TOTDEAUNA, oricate corectii ar fi facut
  // utilizatorul dupa. Cadem inapoi pe ancora: cunostintele fotografice de
  // baza pentru acel feature, exact punctul din care ar fi pornit un model nou.
  return Number.isFinite(next) ? next : anchor;
}

/**
 * Statistici de referinta (medie, deviatie standard) pentru o poza amatoare
 * "obisnuita" — folosite ca sa SEMENE modelul nou-creat cu date reale, nu gol.
 * Bug real gasit: normalize() foloseste valoarea BRUTA (nenormalizata) pentru
 * primele cateva poze dintr-un context nou (`s.n > 2 ? zscore : raw`), pentru
 * ca featureStats pornea complet gol ({}). Cum majoritatea feature-urilor sunt
 * pe scala 0..1 si PRIOR_WEIGHTS de mai sus sunt in marea lor majoritate
 * pozitive, suma ponderata a valorilor BRUTE (nu z-score) iese aproape mereu
 * peste pragul de selectie (65) chiar din prima poza — exact simptomul
 * raportat: "pe telefon nou pare ca aproba tot, fara criterii reale". Cu
 * aceste statistici semanate, normalize() foloseste z-score-uri sensibile
 * (fata de o poza "medie" plauzibila) inca de la prima fotografie, iar pe
 * masura ce utilizatorul ia decizii reale, statisticile Welford converg
 * treptat spre datele lui proprii (vezi PRIOR_N mai jos) — cunostintele
 * generale raman doar un PUNCT DE PORNIRE, nu o limita.
 */
const PRIOR_FEATURE_STATS: Record<string, { mean: number; std: number }> = {
  sharpness: { mean: 0.65, std: 0.18 },
  exposureBalance: { mean: 0.72, std: 0.18 },
  exposureRaw: { mean: 0.5, std: 0.2 },
  highlightClipping: { mean: 0.05, std: 0.08 },
  shadowClipping: { mean: 0.05, std: 0.08 },
  isoPenalty: { mean: 0.15, std: 0.15 },
  apertureRaw: { mean: 0.5, std: 0.25 },
  shutterSpeedRaw: { mean: 0.5, std: 0.25 },
  // echivalent 35mm: ultrawide ~13mm -> 0.05, camera principala ~26mm -> 0.17,
  // tele ~77mm -> 0.37, un 200mm de aparat foto -> 0.54
  focalLengthRaw: { mean: 0.25, std: 0.15 },
  flashFired: { mean: 0.12, std: 0.33 },
  deliberateSettings: { mean: 0.05, std: 0.22 },
  compositionScore: { mean: 0.5, std: 0.2 },
  leadingLines: { mean: 0.25, std: 0.43 },
  symmetry: { mean: 0.25, std: 0.43 },
  negativeSpace: { mean: 0.3, std: 0.2 },
  lightHard: { mean: 0.25, std: 0.43 },
  lightSoft: { mean: 0.25, std: 0.43 },
  goldenHour: { mean: 0.12, std: 0.33 },
  colorHarmony: { mean: 0.6, std: 0.2 },
  bestSmile: { mean: 0.4, std: 0.3 },
  allEyesOpen: { mean: 0.75, std: 0.43 },
  faceCount: { mean: 0.2, std: 0.15 },
  knownFaceRatio: { mean: 0.15, std: 0.3 },
  strangerPenalty: { mean: 0.7, std: 0.35 },
  faceScore: { mean: 0.7, std: 0.2 },
  ruleOfThirds: { mean: 0.5, std: 0.2 },
  headroom: { mean: 0.5, std: 0.2 },
  groupEyesOpenRatio: { mean: 0.75, std: 0.3 },
  groupSmileRatio: { mean: 0.4, std: 0.3 },
  groupAwkwardRatio: { mean: 0.15, std: 0.3 },
  bodyCroppedAtEdge: { mean: 0.1, std: 0.3 },
  groupGenuineSmileRatio: { mean: 0.25, std: 0.35 },
  groupCatchlightRatio: { mean: 0.4, std: 0.35 },
  groupSkinToneNaturalRatio: { mean: 0.7, std: 0.3 },
  avgEyeContact: { mean: 0.5, std: 0.25 },
  avgEngagement: { mean: 0.5, std: 0.25 },
  subjectInFocus: { mean: 0.7, std: 0.46 },
  bokehQuality: { mean: 0.5, std: 0.3 },
  horizonLevel: { mean: 0.7, std: 0.25 },
  // Cele trei de mai jos lipseau de aici, desi intra in vector — deci pentru
  // primele 3 poze in care apar, normalize() folosea valoarea BRUTA (`s.n > 2`),
  // iar apoi un z-score calculat din 3-4 observatii, adica zgomot. La
  // contentAffinity/subjectAffinity efectul era si sistematic, nu doar zgomotos:
  // "nu stiu nimic despre poza asta" inseamna 0.5, iar 0.5 brut x 0.2 pondere =
  // +0.1 adaugat la scorul FIECAREI poze, o inclinare constanta spre "pastreaza"
  // care nu vine din nimic observat. Centrate pe neutru, aceleasi valori devin
  // z-score 0, adica exact ce trebuie sa insemne: nicio contributie.
  contentAffinity: { mean: 0.5, std: 0.15 },
  subjectAffinity: { mean: 0.5, std: 0.15 },
  // Text in cadru: aproape orice poza obisnuita are foarte putin, documentele si
  // capturile de ecran au mult — distributie puternic asimetrica, deci media e
  // mica si deviatia relativ mare fata de ea.
  textCoverage: { mean: 0.08, std: 0.16 },
  // fete tipice de telefon: portret apropiat ~0.35-0.5, poza de grup ~0.15-0.25,
  // om in peisaj sub 0.1 — media ponderata a unei galerii obisnuite sta pe la 0.25
  subjectProminence: { mean: 0.25, std: 0.15 },
  // proportia de fisiere fara EXIF intr-o galerie de telefon obisnuita (capturi
  // de ecran + primite pe mesagerie); std-ul unei variabile binare cu p=0.25
  noCameraMetadata: { mean: 0.25, std: 0.43 }
};

/**
 * "Increderea" (in poze echivalente) acordata statisticilor de mai sus la
 * pornire — Welford le trateaza exact ca pe N poze reale deja vazute. Suficient
 * de mic ca datele reale ale utilizatorului sa preia rapid controlul (dupa
 * cateva zeci de poze proprii, prior-ul e deja o fractiune mica din medie),
 * dar suficient de mare cat sa nu se comporte ca "zgomot" instabil in primele
 * cateva poze (acelasi ordin de marime ca COLD_START_SAMPLES).
 */
const PRIOR_N = 6;

function seedFeatureStats(): Record<string, FeatureStat> {
  const out: Record<string, FeatureStat> = {};
  for (const [k, { mean, std }] of Object.entries(PRIOR_FEATURE_STATS)) {
    out[k] = { mean, m2: std * std * (PRIOR_N - 1), n: PRIOR_N };
  }
  return out;
}

/**
 * Nume scurte, lizibile, per feature — folosite pentru explicabilitate PER POZA
 * ("de ce a primit acest scor", DetailView), diferit de perechile pozitiv/negativ
 * din summarize() (care descriu directia PONDERII invatate, nu contributia unei
 * poze anume). Textul efectiv traieste in i18n (chei `factor.*`) — setul de mai
 * jos doar STIE ce feature-uri au eticheta, ca sa filtram exact ca inainte
 * (un feature necunoscut ramane cu cheia bruta, nu cu un string "factor.xyz" nebun).
 */
const FACTOR_FEATURES = new Set([
  'sharpness', 'exposureBalance', 'exposureRaw', 'bestSmile', 'allEyesOpen', 'faceCount',
  'knownFaceRatio', 'strangerPenalty', 'faceScore', 'ruleOfThirds', 'headroom',
  'groupEyesOpenRatio', 'groupSmileRatio', 'groupAwkwardRatio', 'groupGenuineSmileRatio', 'groupCatchlightRatio', 'groupSkinToneNaturalRatio', 'avgEyeContact', 'avgEngagement',
  'highlightClipping', 'shadowClipping', 'horizonLevel', 'isoPenalty', 'apertureRaw',
  'shutterSpeedRaw', 'focalLengthRaw', 'flashFired', 'deliberateSettings',
  'compositionScore', 'leadingLines', 'symmetry',
  'negativeSpace', 'lightHard', 'lightSoft', 'goldenHour', 'subjectInFocus',
  'bokehQuality', 'colorHarmony', 'bodyCroppedAtEdge', 'subjectProminence', 'noCameraMetadata'
]);

/**
 * Feature-uri "de defect": valoarea bruta masoara CAT de mult dintr-un
 * lucru nedorit e prezent (fractie de highlights arse, umbre blocate,
 * straini in cadru, zgomot ISO) — nu "cat de mult dintr-un lucru dorit".
 * O contributie POZITIVA la aceste feature-uri inseamna "aproape deloc
 * din acest defect", nu "acest defect a ajutat poza". Eticheta unica
 * folosita inainte de acest fix ("Highlights arse", cu "+" langa ea)
 * citea backwards — sugera ca prezenta highlights-urilor arse ar fi un
 * punct in favoarea pozei. Fiecare din aceste feature-uri are acum DOUA
 * chei i18n (`factor.<feature>` pentru contributie negativa = defectul
 * chiar a fost prezent si a costat scorul; `factor.<feature>.pos` pentru
 * contributie pozitiva = absenta lui a ajutat), alese in functie de semn.
 */
const INVERTED_SENSE_FEATURES = new Set(['highlightClipping', 'shadowClipping', 'strangerPenalty', 'isoPenalty', 'groupAwkwardRatio', 'bodyCroppedAtEdge', 'noCameraMetadata']);

function factorLabel(locale: Locale, feature: string, positive = false): string {
  if (!FACTOR_FEATURES.has(feature)) return feature;
  if (positive && INVERTED_SENSE_FEATURES.has(feature)) return t(locale, `factor.${feature}.pos`);
  return t(locale, `factor.${feature}`);
}

/** Transforma topFactors dintr-o Prediction in etichete afisabile, filtrand contributiile neglijabile. */
export function explainFactors(
  topFactors: { feature: string; contribution: number }[],
  locale: Locale = 'ro'
): { label: string; positive: boolean }[] {
  return topFactors
    .filter(f => FACTOR_FEATURES.has(f.feature) && Math.abs(f.contribution) > 0.03)
    .map(f => {
      const positive = f.contribution >= 0;
      return { label: factorLabel(locale, f.feature, positive), positive };
    });
}

// ── Feature extraction ───────────────────────────────────────────────────────

/**
 * Feature-uri care N-AU SENS fara o fata detectata (smile/ochi/incadrarea
 * fetei/bokeh subiect-fundal etc.) — pentru o poza de peisaj/natura/animale
 * (faceCount === 0), worker-ul le umple oricum cu o valoare "filler" (0 sau
 * 0.5: bestSmile=0, ruleOfThirds=0.5, bokehQuality='n/a'→0.5...), NU o masuratoare
 * reala. Bug real raportat: poze de peisaj bune, respinse de AI — cauza era
 * exact aici. La cold-start (context nou, sampleCount mic), predict() se
 * bazeaza pe modelul GLOBAL, antrenat din TOATE corectiile utilizatorului
 * (portrete incluse); daca acel model global a invatat, de la portrete, ponderi
 * pozitive pentru bestSmile/ruleOfThirds/etc., iar media lor invatata (folosita
 * la normalizare z-score) e mult peste 0/0.5, atunci valoarea "filler" a unui
 * peisaj se normalizeaza puternic NEGATIV — o penalizare complet artificiala,
 * pentru o caracteristica ce pur si simplu nu se aplica pozei. Solutia: pentru
 * faceCount === 0, aceste feature-uri nu mai apar deloc in vector (nu sunt
 * "0"/"neutru", sunt ABSENTE) — nici predict(), nici trainOne() nu le mai
 * privesc/actualizeaza pentru o astfel de poza, deci nu mai pot contamina sau
 * fi contaminate de modelul global antrenat pe portrete.
 */
export const FACE_ONLY_FEATURES = [
  'bestSmile', 'allEyesOpen', 'faceCount', 'knownFaceRatio', 'strangerPenalty', 'faceScore',
  'ruleOfThirds', 'headroom', 'groupEyesOpenRatio', 'groupSmileRatio', 'groupAwkwardRatio', 'groupGenuineSmileRatio', 'groupCatchlightRatio', 'groupSkinToneNaturalRatio', 'avgEyeContact',
  'avgEngagement', 'subjectInFocus', 'bokehQuality', 'bodyCroppedAtEdge', 'subjectProminence'
] as const;

/**
 * Oglinda exacta a bug-ului FACE_ONLY_FEATURES de mai sus, gasita de auditul
 * QA: faceAnalysis.worker.ts calculeaza horizonTiltDeg DOAR pentru
 * faceCount === 0 (structural, nu doar "uneori nemasurabil" — vezi
 * `...(horizonTiltDeg !== null ? {...} : {})` in worker). Inainte de acest
 * fix, horizonLevel intra totusi in blocul UNIVERSAL din extractFeatures, deci
 * fiecare portret/poza de grup trimitea o valoare filler (0.5, "neutru") la
 * trainOne() — inclusiv la modelul GLOBAL_CONTEXT_KEY, folosit la blending-ul
 * de cold-start pentru orice context nou, peisaje incluse. Daca portretele
 * domina istoricul unui utilizator, statisticile Welford ale GLOBAL pentru
 * horizonLevel se aduna in jurul valorii filler constante — cand un peisaj
 * cu orizont REAL intra la cold-start, z-score-ul lui normalizat devine
 * artificial amplificat (clamp la ±3), o contributie zgomotoasa, nelegata de
 * nicio preferinta reala invatata.
 */
export const LANDSCAPE_ONLY_FEATURES = ['horizonLevel'] as const;

/**
 * Peisaj/natura fara subiect uman: claritatea globala pe tot cadrul e o
 * masura mult mai putin de incredere decat la un portret. Perspectiva
 * atmosferica — un principiu de baza in fotografia de peisaj — descrie exact
 * fenomenul ca planurile indepartate (munti, ceata, nori) apar NATURAL mai
 * putin definite, mai putin contrastate, usor voalate, fara sa fie un defect;
 * la fel, o diafragma inchisa (f/11-f/16, alegerea clasica de peisaj pentru
 * claritate front-to-back) tot lasa straturile foarte indepartate usor moi.
 * Feedback direct: o poza de munte cu cer dramatic, respinsa aproape doar
 * din cauza "Claritate" (scor global de claritate moderat, din voalul
 * atmosferic natural pe crestele indepartate) — utilizatorul o considera buna.
 * Curba (exponent subunitar) comprima diferenta pentru valori medii-mici
 * (48/100 -> ~0.64, mai putin punitiv) fara sa ascunda o poza cu adevarat
 * neclara (20/100 -> ~0.38, tot clar sub medie) si fara sa schimbe practic
 * nimic pentru poze deja foarte clare (90/100 -> ~0.94). Portretele raman
 * neatinse — acolo claritatea subiectului chiar conteaza direct, fara nuanta.
 */
export function landscapeSharpness(rawSharpness: number): number {
  return Math.pow(Math.max(0, rawSharpness) / 100, 0.6);
}

/**
 * "Exista un SUBIECT uman", nu doar "exista o fata" — vezi core/subjectProminence.ts
 * pentru regula in sine si pentru tot ce strica un trecator minuscul.
 *
 * Deliberat NU schimba si blocul FACE_ONLY_FEATURES: zambetul/ochii unei fete
 * mici sunt masurati, doar mai putin siguri — a-i sterge cu totul ar arunca
 * informatie reala. Aici se decide doar CUM e judecat cadrul in ansamblu.
 *
 * `faces` gol cu faceCount > 0 (inregistrari mai vechi, fara cutii salvate)
 * pastreaza comportamentul de dinainte: prominent.
 */
export function hasProminentSubject(a: Pick<AnalysisRecord, 'faceCount' | 'faces'>): boolean {
  if (a.faceCount === 0) return false;
  if (!a.faces.length) return true;
  return hasProminentFace(a.faces);
}

/**
 * Fisierul nu poarta NICIO urma de aparat foto: nici marca/model, nici
 * ISO/diafragma/timp de expunere/focala. Intr-o galerie de telefon asta descrie
 * aproape exact categoria de "poze care nu sunt pozele tale" — capturi de ecran,
 * meme-uri descarcate, imagini primite pe WhatsApp (care sterge metadatele la
 * trimitere). Exact gunoiul pe care culling-ul ar trebui sa-l scoata primul, si
 * pe care restul semnalelor nu-l vad deloc: o captura de ecran e perfect clara,
 * perfect expusa si fara zgomot.
 *
 * NU e o regula stricta, ci un feature ca oricare altul, cu pondere negativa
 * modesta: un export editat (Lightroom, un crop salvat) poate pierde EXIF-ul
 * fara sa fie gunoi, iar PNG/WebP nu au EXIF prin definitie. Cine chiar isi tine
 * capturile de ecran isi va vedea ponderea urcand inapoi spre zero.
 */
export function lacksCameraMetadata(
  a: Pick<AnalysisRecord, 'cameraMake' | 'cameraModel' | 'iso' | 'fNumber' | 'exposureTime' | 'focalLength'>
): boolean {
  return a.cameraMake === undefined && a.cameraModel === undefined
    && a.iso === undefined && a.fNumber === undefined
    && a.exposureTime === undefined && a.focalLength === undefined;
}

/** Focala in echivalent 35mm — singura comparabila intre aparate; focala bruta doar ca rezerva. */
function focalLengthEquivalent(a: Pick<AnalysisRecord, 'focalLength35mm' | 'focalLength'>): number | undefined {
  return a.focalLength35mm ?? a.focalLength;
}

/** Fotograful a umblat pe setari in loc sa lase totul automat — vezi feature-ul deliberateSettings. */
function hasDeliberateSettings(a: Pick<AnalysisRecord, 'exposureBias' | 'whiteBalance'>): boolean {
  return (a.exposureBias !== undefined && Math.abs(a.exposureBias) >= 0.3) || a.whiteBalance === 'manual';
}

export function extractFeatures(a: AnalysisRecord, memorySignals?: { contentAffinity?: number | null; subjectAffinity?: number | null }): FeatureVector {
  const features: FeatureVector = {
    // "subiect uman prominent", nu "exista o fata" — vezi hasProminentSubject
    sharpness: hasProminentSubject(a) ? a.sharpness / 100 : landscapeSharpness(a.sharpness),
    // distance from mid-exposure — lets the model learn a *preference direction*
    exposureBalance: 1 - Math.abs(a.exposure - 50) / 50,
    exposureRaw: a.exposure / 100,           // raw value → can learn "prefers darker"
    // clipping: fara date (inregistrari vechi) = presupunem 0 (fara clipping), nu neutru —
    // altfel penalizam artificial poze analizate inainte de aceasta functie
    highlightClipping: a.highlightClipping ?? 0,
    shadowClipping: a.shadowClipping ?? 0,
    // EXIF — scale logaritmice (in "stops", cum gandesc fotografii), 0 cand
    // lipseste (coincide cu "ISO de baza", nu introduce penalizare falsa)
    isoPenalty: a.iso !== undefined ? Math.min(1, Math.max(0, Math.log2(Math.max(a.iso, 50) / 100) / 6)) : 0,
    // diafragma/viteza/focala: 0.5 (neutru) cand lipsesc — ponderea de start
    // e oricum 0, dar 0.5 e mai corect semantic decat 0 daca modelul invata
    // vreodata o pondere ne-zero (0 ar insemna "extrem", nu "necunoscut")
    apertureRaw: a.fNumber !== undefined ? Math.min(1, Math.max(0, (a.fNumber - 1) / 21)) : 0.5,
    shutterSpeedRaw: a.exposureTime && a.exposureTime > 0
      ? Math.min(1, Math.max(0, Math.log2(Math.max(1 / a.exposureTime, 1)) / 13))
      : 0.5,
    // Focala: ECHIVALENTUL 35mm cand exista, focala bruta doar ca rezerva.
    // Bruta e incomparabila intre aparate — 4mm pe un telefon inseamna ~26mm
    // echivalent, iar scala de mai jos porneste de la 10mm, deci TOATE focalele
    // brute de telefon (2-9mm) se prabuseau in aceeasi valoare, 0: ultrawide,
    // camera principala si teleobiectivul erau indistinctibile pentru motor,
    // exact pe platforma unde conteaza cel mai mult.
    focalLengthRaw: focalLengthEquivalent(a) !== undefined
      ? Math.min(1, Math.max(0, Math.log2(Math.max(focalLengthEquivalent(a)!, 10) / 10) / 8))
      : 0.5,
    // Blitz declansat. Fara directie universala — pe telefon inseamna de obicei
    // lumina dura si frontala, dar exista si poze bune facute asa, deci pornim
    // de la 0 si lasam corectiile reale sa decida (acelasi tipar ca diafragma/
    // viteza). 0 si cand EXIF-ul lipseste: "fara blitz" e presupunerea corecta
    // pentru covarsitoarea majoritate a pozelor.
    flashFired: a.flashFired ? 1 : 0,
    // Fotograful a intervenit pe setari (compensare de expunere sau balans de
    // alb manual) — pe un telefon asta cere intrarea in modul pro, deci e un
    // semn ca poza a contat pentru el. NEVERIFICAT pe date reale, si rar in
    // practica: pondere pozitiva mica.
    deliberateSettings: hasDeliberateSettings(a) ? 1 : 0,
    // analiza estetica avansata — booleene absente (inregistrari mai vechi) =
    // neutru (0.5), nu 0/1, ca sa nu penalizeze/favorizeze artificial poze
    // analizate inainte de aceste campuri (acelasi tipar ca mai sus)
    compositionScore: a.compositionScore ?? 0.5,
    leadingLines: a.leadingLinesDetected === undefined ? 0.5 : (a.leadingLinesDetected ? 1 : 0),
    symmetry: a.symmetryDetected === undefined ? 0.5 : (a.symmetryDetected ? 1 : 0),
    negativeSpace: a.negativeSpaceScore ?? 0.5,
    lightHard: a.lightQuality === 'hard' ? 1 : 0,
    lightSoft: a.lightQuality === 'soft' ? 1 : 0,
    goldenHour: a.goldenHourDetected ? 1 : 0,
    colorHarmony: a.colorHarmonyScore ?? 0.5
  };

  // Cu ce seamana pozele pe care le pastrezi (vezi learning/embeddingMemory.ts).
  // ABSENT, nu 0.5, cand nu stim inca — un feature "neutru" trimis la fiecare
  // poza polueaza statisticile de normalizare exact ca in cazul horizonLevel
  // descris mai sus.
  if (memorySignals?.contentAffinity !== undefined && memorySignals.contentAffinity !== null) {
    features.contentAffinity = memorySignals.contentAffinity;
  }
  // Ce SUBIECTE pastrezi, dupa etichetele de scena (vezi learning/tagMemory.ts).
  // Acopera si pozele CU fete, unde contentAffinity de mai sus lipseste
  // structural (embedding-ul se calculeaza doar cand nu exista fete).
  if (memorySignals?.subjectAffinity !== undefined && memorySignals.subjectAffinity !== null) {
    features.subjectAffinity = memorySignals.subjectAffinity;
  }
  // Cat din cadru e text (documente, capturi de ecran). Se calcula deja, dar era
  // folosit DOAR ca poarta binara la auto-selectare (decidePhotoStatus) — ca
  // feature, motorul poate invata si contrariul, pentru cine chiar isi tine
  // capturile de ecran.
  if (a.textCoverage !== undefined) features.textCoverage = a.textCoverage;
  // Nicio urma de aparat foto in fisier (capturi de ecran, meme-uri, imagini
  // primite) — vezi lacksCameraMetadata.
  features.noCameraMetadata = lacksCameraMetadata(a) ? 1 : 0;

  if (a.faceCount > 0) {
    // Cat de mare e omul in cadru — absent, nu 0, cand nu avem cutiile fetelor
    // (inregistrari mai vechi): "nu stiu" nu inseamna "subiect minuscul".
    const prominence = subjectProminence(a.faces);
    if (prominence !== null) features.subjectProminence = prominence;
    features.bestSmile = a.bestSmile;
    features.allEyesOpen = a.allEyesOpen ? 1 : 0;
    features.faceCount = Math.min(a.faceCount, 6) / 6;
    features.knownFaceRatio = a.faceCount ? a.knownFaceCount / a.faceCount : 0;
    features.strangerPenalty = a.faceCount ? a.strangerCount / a.faceCount : 0;
    features.faceScore = a.faces.length
      ? a.faces.reduce((s, f) => s + f.faceScore, 0) / a.faces.length
      : 0;
    features.ruleOfThirds = a.ruleOfThirds ?? 0.5;
    features.headroom = a.headroom ?? 0.5;
    features.groupEyesOpenRatio = a.groupEyesOpenRatio ?? 0.5;
    features.groupSmileRatio = a.groupSmileRatio ?? 0.5;
    features.groupAwkwardRatio = a.groupAwkwardRatio ?? 0.5;
    features.groupGenuineSmileRatio = a.groupGenuineSmileRatio ?? 0.5;
    features.groupCatchlightRatio = a.groupCatchlightRatio ?? 0.5;
    features.groupSkinToneNaturalRatio = a.groupSkinToneNaturalRatio ?? 0.5;
    features.avgEyeContact = a.avgEyeContact ?? 0.5;
    features.avgEngagement = a.avgEngagement ?? 0.5;
    features.subjectInFocus = a.subjectInFocus === undefined ? 0.5 : (a.subjectInFocus ? 1 : 0);
    features.bokehQuality = a.bokehQuality === 'good' ? 1 : a.bokehQuality === 'poor' ? 0 : 0.5;
    // Android nativ, NEVERIFICAT pe date reale (vezi hasAwkwardBodyCrop in
    // nativeAnalysis.ts) — absent pe web/PWA si pe inregistrari mai vechi,
    // tratat neutru (0.5), nu "asumat fara defect" (0), acelasi tipar ca restul.
    features.bodyCroppedAtEdge = a.bodyCroppedAtEdge === undefined ? 0.5 : (a.bodyCroppedAtEdge ? 1 : 0);
  }

  // Orizont: convertit din grade in scor 0..1 (1 = perfect drept). Poarta e
  // "fara subiect uman PROMINENT", nu "fara nicio fata" — un peisaj cu un
  // trecator mic in cadru e tot un peisaj, si are tot un orizont de judecat
  // (vezi core/subjectProminence.ts; analiza il si calculeaza acum acolo).
  //
  // Conditia a doua tine cont de inregistrarile mai vechi, facute cand poarta
  // din analiza era inca `faceCount === 0`: acolo o poza cu o fata mica nu are
  // orizontul masurat, si atunci il OMITEM in loc sa trimitem 0.5 filler — vezi
  // LANDSCAPE_ONLY_FEATURES pentru ce anume strica un filler constant. Pentru
  // pozele fara nicio fata pastram 0.5 cand masuratoarea chiar a esuat (prea
  // putine muchii clare), exact ca inainte.
  if (!hasProminentSubject(a) && (a.horizonTiltDeg !== undefined || a.faceCount === 0)) {
    features.horizonLevel = a.horizonTiltDeg !== undefined ? Math.max(0, 1 - Math.abs(a.horizonTiltDeg) / 15) : 0.5;
  }

  return features;
}

/**
 * Context key: [gen:] + sceneType + subject familiarity. Each key gets its own model.
 * Genul fotografic (optional, ales de utilizator per import — vezi state/genre.ts si
 * PhotoRecord.genre) prefixeaza cheia: "Nunta:portrait:known" invata ponderi complet
 * separate de "Peisaj:landscape" sau de "portrait:known" (fara gen ales). Aceasta e
 * extensia "ContextEngine 2.0" din planul de dezvoltare — utilizatorii care lucreaza
 * in mai multe genuri (nunti vs. peisaj) nu mai impart acelasi model per scena.
 */
export function deriveContextKey(a: AnalysisRecord, genre?: string): string {
  const base =
    a.faceCount === 0 ? a.sceneType               // "landscape" | "detail"
    : a.strangerCount === 0 ? `${a.sceneType}:known`
    : a.knownFaceCount === 0 ? `${a.sceneType}:strangers`
    : `${a.sceneType}:mixed`;
  const trimmed = genre?.trim();
  return trimmed ? `${trimmed}:${base}` : base;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class ContextEngine {
  private models = new Map<string, ContextModelRecord>();
  /** Memoria de continut (vezi learning/embeddingMemory.ts) — tinuta aici ca predict() sa nu citeasca din DB pentru fiecare poza dintr-un import de sute. */
  private embeddingMemory: EmbeddingMemoryRecord | undefined;
  private tagMemory: TagMemoryRecord | undefined;
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Bug real gasit de auditul QA: fara `loadingPromise`, doua apeluri
   * concurente in init() pe un engine virgin (ex. predict() dintr-un import
   * si recordCorrection() dintr-o decizie manuala, aproape simultan) treceau
   * amandoua testul `if (this.loaded) return` (inca false pentru ambele) si
   * fiecare re-citea+repopula independent this.models — daca o mutatie
   * trainOne() de la primul flux ajungea intre cele doua citiri, al doilea
   * init() o putea suprascrie silentios cu o instantanee mai veche, dinainte
   * de mutatie. Acum orice apel concurent asteapta ACEEASI incarcare in curs,
   * nu porneste una noua.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        const [rows, memory, tags] = await Promise.all([
          db.contextModels.toArray(), readEmbeddingMemory(), readTagMemory()
        ]);
        for (const row of rows) this.models.set(row.contextKey, row);
        this.embeddingMemory = memory;
        this.tagMemory = tags;
        this.loaded = true;
      })().finally(() => { this.loadingPromise = null; });
    }
    await this.loadingPromise;
  }

  /** Cele doua semnale de memorie ale acestei poze — fiecare null cand nu se aplica (lipsa datelor sau prea putine decizii). */
  private memorySignals(analysis: AnalysisRecord): { contentAffinity: number | null; subjectAffinity: number | null } {
    return {
      contentAffinity: analysis.imageEmbedding ? affinity(analysis.imageEmbedding, this.embeddingMemory) : null,
      subjectAffinity: tagAffinity(analysis.sceneTags, this.tagMemory)
    };
  }

  // ── Prediction ─────────────────────────────────────────────────────────────

  async predict(analysis: AnalysisRecord, genre?: string): Promise<Prediction> {
    await this.init();
    const contextKey = deriveContextKey(analysis, genre);
    const model = this.getOrCreateModel(contextKey);
    const globalModel = this.getOrCreateModel(GLOBAL_CONTEXT_KEY);
    const features = extractFeatures(analysis, this.memorySignals(analysis));
    const normalized = this.normalize(model, features, /*update=*/ false);
    const globalNormalized = this.normalize(globalModel, features, /*update=*/ false);

    // Shrinkage catre backbone-ul global: cu putine corectii proprii (sampleCount
    // mic), contextul se bazeaza mai mult pe preferintele generale acumulate din
    // TOATE corectiile utilizatorului; pe masura ce primeste destule corectii
    // proprii, converge treptat spre propriile ponderi, mai specifice.
    const alpha = model.sampleCount / (model.sampleCount + GLOBAL_BLEND_K);

    let z = alpha * model.bias + (1 - alpha) * globalModel.bias;
    const contributions: { feature: string; contribution: number }[] = [];
    for (const k of Object.keys(normalized)) {
      const wContext = model.weights[k] ?? 0;
      const wGlobal = globalModel.weights[k] ?? 0;
      const raw = alpha * wContext * normalized[k] + (1 - alpha) * wGlobal * globalNormalized[k];
      // A doua poarta impotriva NaN, dupa cea din normalize(): acolo se opreste
      // o VALOARE corupta, aici o PONDERE corupta (model restaurat dintr-un
      // backup editat de om — restoreBackup scrie contextModels verbatim).
      // Vezi comentariul lung de la normalize() pentru ce strica exact un
      // aiScore NaN ajuns in db.analyses (camp indexat, NaN nu e cheie valida).
      const contribution = Number.isFinite(raw) ? raw : 0;
      z += contribution;
      contributions.push({ feature: k, contribution });
    }
    const probability = Number.isFinite(z) ? 1 / (1 + Math.exp(-z)) : 0.5;
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      score: Math.round(probability * 100),
      probability,
      contextKey,
      confidence:
        model.sampleCount < COLD_START_SAMPLES ? 'cold'
        : model.sampleCount < TRAINED_SAMPLES ? 'warming'
        : 'trained',
      topFactors: contributions.slice(0, 4)
    };
  }

  // ── Learning from manual corrections ───────────────────────────────────────

  /**
   * Called on EVERY manual decision (not only disagreements): agreements
   * reinforce, disagreements correct. Online SGD on log-loss.
   *
   * Returneaza `topShift` — cerinta directa a utilizatorului: un mic
   * toast imediat ("Am invatat: X"), NU doar panoul agregat "Preferinte AI"
   * (deja existent, InsightsPanel.tsx) pe care trebuie sa-l deschizi manual.
   * Calculat DOAR la un dezacord real (aiDecision !== userDecision) — o
   * confirmare a ceea ce AI-ul deja propunea intareste ponderile cu un pas
   * minuscul, nu are ce sa anunte ca "nou invatat"; un toast la fiecare
   * P/X ar fi oricum zgomot pur culling-uind sute de poze. Restrans la
   * modelul PER-CONTEXT (nu si backbone-ul global) si la PREF_FEATURES
   * (acelasi subset deja folosit de summarize() pentru panoul agregat) —
   * consistenta cu ce utilizatorul poate vedea acolo daca deschide panoul.
   */
  async recordCorrection(input: CorrectionInput): Promise<{ topShift: WeightShift | null }> {
    await this.init();
    const contextKey = deriveContextKey(input.analysis, input.genre);
    const model = this.getOrCreateModel(contextKey);
    const globalModel = this.getOrCreateModel(GLOBAL_CONTEXT_KEY);
    const features = extractFeatures(input.analysis, this.memorySignals(input.analysis));
    const disagreement = input.aiDecision !== input.userDecision;
    const weightsBefore = disagreement ? { ...model.weights } : null;

    this.trainOne(model, features, input);
    // backbone-ul global invata din FIECARE corectie, indiferent de context —
    // vezi comentariul de la GLOBAL_CONTEXT_KEY si blending-ul din predict().
    this.trainOne(globalModel, features, input);

    // Bug real gasit de auditul QA: cele 3 scrieri (model de context, model
    // global, log de corectii) mergeau prin Promise.all NEATOMIC — acelasi
    // tipar deja identificat si reparat cu db.transaction() in
    // importPipeline.ts (processOne) si backupService.ts (restoreBackup). O
    // intrerupere la mijloc (crash/tab inchis) putea lasa modelele si logul
    // de corectii inconsistente intre ele.
    await db.transaction('rw', db.contextModels, db.corrections, async () => {
      await Promise.all([
        db.contextModels.put(model),
        db.contextModels.put(globalModel),
        db.corrections.add({
          photoId: input.photoId,
          contextKey,
          features,
          aiDecision: input.aiDecision,
          userDecision: input.userDecision,
          ts: Date.now()
        })
      ]);
    });

    // Memoria de continut invata din aceeasi decizie (vezi learning/embeddingMemory.ts).
    // Dupa transactie, si tolerant la esec: e un semnal in plus, nu are voie sa
    // strice o corectie deja scrisa daca scrierea asta pica.
    try {
      if (input.analysis.imageEmbedding?.length) {
        await recordEmbeddingDecision(input.analysis.imageEmbedding, input.userDecision);
        this.embeddingMemory = await readEmbeddingMemory();
      }
      if (input.analysis.sceneTags?.length) {
        await recordTagDecision(input.analysis.sceneTags, input.userDecision);
        this.tagMemory = await readTagMemory();
      }
    } catch (err) {
      console.error('Nu am putut actualiza memoria de continut/subiecte (corectia s-a salvat oricum):', err);
    }

    return { topShift: weightsBefore ? this.biggestPrefShift(weightsBefore, model.weights, features, input.locale ?? 'ro') : null };
  }

  /** Feature-ul (dintre PREF_FEATURES, prezent in vectorul ACESTEI poze) a carui pondere s-a schimbat cel mai mult la acest pas — null daca nimic n-a trecut de PREF_SHIFT_THRESHOLD. */
  private biggestPrefShift(before: FeatureVector, after: FeatureVector, features: FeatureVector, locale: Locale): WeightShift | null {
    let best: { feature: string; delta: number } | null = null;
    for (const feature of Object.keys(features)) {
      if (!ContextEngine.PREF_FEATURES.has(feature)) continue;
      const delta = Math.abs((after[feature] ?? 0) - (before[feature] ?? 0));
      if (delta > PREF_SHIFT_THRESHOLD && (!best || delta > best.delta)) best = { feature, delta };
    }
    if (!best) return null;
    const sign = (after[best.feature] ?? 0) >= 0 ? 'pos' : 'neg';
    return { feature: best.feature, label: t(locale, `insightsPref.${best.feature}.${sign}`) };
  }

  /** Un pas de SGD online (forward + backward + update), aplicat pe orice model — context specific sau backbone-ul global. */
  private trainOne(model: ContextModelRecord, features: FeatureVector, input: CorrectionInput): void {
    // Update normalization stats FIRST (Welford), then normalize with them.
    const normalized = this.normalize(model, features, /*update=*/ true);

    // Forward pass
    let z = model.bias;
    for (const [k, v] of Object.entries(normalized)) z += (model.weights[k] ?? 0) * v;
    const p = 1 / (1 + Math.exp(-z));
    const y = input.userDecision ? 1 : 0;
    const error = p - y;

    // Adaptive learning rate: fast when cold, stable when trained.
    // Disagreements with the AI are stronger evidence → boosted step.
    const disagreement = input.aiDecision !== input.userDecision;
    const lr = (BASE_LR / Math.sqrt(model.sampleCount + 1)) * (disagreement ? 1.6 : 1.0);

    // Regularizare spre ANCORA (prior), nu spre zero — vezi updateWeight/L2_LAMBDA.
    for (const [k, v] of Object.entries(normalized)) {
      model.weights[k] = updateWeight(model.weights[k] ?? 0, error * v, lr, priorAnchor(k));
    }
    model.bias -= lr * error;
    model.sampleCount++;
    model.updatedAt = Date.now();
  }

  // ── Explainability (feeds the "Preferinte AI" panel in UI) ─────────────────

  /**
   * Feature-urile care au o pereche de note de directie in i18n (chei
   * `insightsPref.<feature>.pos` / `.neg`) — subset din FACTOR_FEATURES:
   * faceCount si faceScore nu au o "directie de preferinta" naturala de
   * exprimat (numarul de fete sau calitatea generica a detectiei nu se
   * traduc intr-un enunt gen "prefera mai multe fete"), asa ca raman
   * excluse din summarize() exact ca in versiunea originala.
   */
  private static readonly PREF_FEATURES = new Set([
    'sharpness', 'exposureRaw', 'bestSmile', 'allEyesOpen', 'knownFaceRatio', 'strangerPenalty',
    'ruleOfThirds', 'headroom', 'groupEyesOpenRatio', 'groupSmileRatio', 'groupAwkwardRatio', 'groupGenuineSmileRatio', 'groupCatchlightRatio', 'groupSkinToneNaturalRatio', 'avgEyeContact',
    'avgEngagement', 'highlightClipping', 'shadowClipping', 'horizonLevel', 'isoPenalty',
    'apertureRaw', 'shutterSpeedRaw', 'focalLengthRaw', 'flashFired', 'deliberateSettings',
    'compositionScore', 'leadingLines',
    'symmetry', 'negativeSpace', 'lightHard', 'lightSoft', 'goldenHour', 'subjectInFocus',
    'bokehQuality', 'colorHarmony', 'subjectProminence', 'noCameraMetadata'
  ]);

  /** Rezumat lizibil al tuturor contextelor invatate — pentru panoul "Preferinte AI" din UI. */
  /**
   * Cat de mult sa aiba incredere restul aplicatiei in ce a invatat motorul,
   * 0..1 (0 = nimic invatat inca, 1 = model antrenat).
   *
   * Citit din backbone-ul GLOBAL, nu dintr-un context anume: cine intreaba
   * (alegerea celui mai bun cadru dintr-o serie — core/groupSelection.ts) are
   * de comparat cadre din ACELASI context intre ele, deci intrebarea reala e
   * "a apucat omul sa-si arate preferintele in general?", nu "in scena asta".
   * Aceeasi scara ca `confidence` din predict(): plin la TRAINED_SAMPLES.
   */
  async learnedWeight(): Promise<number> {
    await this.init();
    const global = this.getOrCreateModel(GLOBAL_CONTEXT_KEY);
    return Math.max(0, Math.min(1, global.sampleCount / TRAINED_SAMPLES));
  }

  async summarize(locale: Locale = 'ro'): Promise<{
    contextKey: string;
    sampleCount: number;
    confidence: Prediction['confidence'];
    notes: string[];
    /** aceleasi ponderi de top care alimenteaza `notes`, in forma bruta — pentru grafice (InsightsChart). */
    topWeights: { feature: string; label: string; weight: number }[];
    /**
     * TOATE ponderile modelului (nu doar top 4), inclusiv cele aproape zero —
     * pentru utilizatorii care vor sa vada profilul complet invatat, nu doar
     * un rezumat. Spre deosebire de topWeights, nu e gatat de COLD_START_SAMPLES:
     * starea reala (chiar daca e doar prior-ul initial) e mai utila decat gol.
     */
    allWeights: { feature: string; label: string; weight: number }[];
  }[]> {
    await this.init();
    const prefFeatures = ContextEngine.PREF_FEATURES;
    return Array.from(this.models.values())
      // backbone-ul global (GLOBAL_CONTEXT_KEY) nu e un "context" pe care utilizatorul
      // l-a ales vreodata — e plumbing intern pentru predict(), nu apare in acest panou
      .filter(model => model.contextKey !== GLOBAL_CONTEXT_KEY)
      .map(model => {
        const ranked = Object.entries(model.weights)
          .filter(([k]) => prefFeatures.has(k))
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 4);
        return {
          contextKey: model.contextKey,
          sampleCount: model.sampleCount,
          confidence:
            model.sampleCount < COLD_START_SAMPLES ? ('cold' as const)
            : model.sampleCount < TRAINED_SAMPLES ? ('warming' as const)
            : ('trained' as const),
          notes: model.sampleCount < COLD_START_SAMPLES ? [] : ranked.map(([k, w]) =>
            t(locale, `insightsPref.${k}.${w >= 0 ? 'pos' : 'neg'}`)
          ),
          topWeights: model.sampleCount < COLD_START_SAMPLES ? [] : ranked.map(([k, w]) => ({
            feature: k, label: factorLabel(locale, k), weight: w
          })),
          allWeights: Object.entries(model.weights)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .map(([k, w]) => ({ feature: k, label: factorLabel(locale, k), weight: w }))
        };
      })
      .sort((a, b) => b.sampleCount - a.sampleCount);
  }

  /** Re-citeste modelele din DB, ignorand cache-ul in memorie — necesar dupa ce alt cod (ex. restaurarea unui backup) a scris direct in db.contextModels. */
  async reload(): Promise<void> {
    this.models.clear();
    this.embeddingMemory = undefined;
    this.tagMemory = undefined;
    this.loaded = false;
    await this.init();
  }

  async reset(contextKey?: string): Promise<void> {
    if (contextKey) {
      this.models.delete(contextKey);
      await db.contextModels.delete(contextKey);
    } else {
      this.models.clear();
      await db.contextModels.clear();
      // Memoria de continut e tot preferinta invatata — un reset complet o
      // include, la fel ca ponderile. Un reset PE CONTEXT nu: memoria e una
      // singura, comuna tuturor contextelor.
      this.embeddingMemory = undefined;
      this.tagMemory = undefined;
      await Promise.all([resetEmbeddingMemory(), resetTagMemory()]);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Bug real gasit de auditul QA, in tandem cu validarea din
   * core/backupService.ts: un ContextModelRecord poate ajunge in IndexedDB cu
   * campuri lipsa (restaurare a unui backup trunchiat/editat — inainte de fix,
   * restoreBackup scria lista verbatim cu bulkPut). Efectul era o eroare
   * PERMANENTA, nu una trecatoare: `model.weights[k]` pe un `weights`
   * undefined arunca `TypeError: Cannot read properties of undefined`, la
   * FIECARE poza scorata, iar inregistrarea stricata traieste pe disc — deci
   * reload-ul paginii n-o repara, reimportul pozelor n-o repara, si scorarea
   * AI ramanea moarta pentru acel context pana la stergerea datelor din browser.
   *
   * Validarea din backupService opreste scrierile NOI, dar nu repara bazele
   * deja stricate ale utilizatorilor care au restaurat inainte de acest fix.
   * De asta reparam si la CITIRE: orice camp lipsa/de tip gresit revine la
   * valoarea unui model nou (prior-uri + statistici semanate), pastrand ce e
   * inca folosibil din inregistrare. Un model care si-a pierdut ponderile
   * porneste de la cunostintele de baza — mult mai bine decat sa nu mai poata
   * scora nimic niciodata.
   */
  private static repair(model: ContextModelRecord): ContextModelRecord {
    const isNumberRecord = (v: unknown): boolean =>
      !!v && typeof v === 'object' && !Array.isArray(v)
      && Object.values(v as Record<string, unknown>).every(n => typeof n === 'number' && Number.isFinite(n));
    if (!isNumberRecord(model.weights)) model.weights = { ...PRIOR_WEIGHTS };
    if (!model.featureStats || typeof model.featureStats !== 'object') model.featureStats = seedFeatureStats();
    if (!Number.isFinite(model.bias)) model.bias = 0;
    if (!Number.isFinite(model.sampleCount) || model.sampleCount < 0) model.sampleCount = 0;
    return model;
  }

  private getOrCreateModel(contextKey: string): ContextModelRecord {
    let model = this.models.get(contextKey);
    if (!model) {
      model = {
        contextKey,
        weights: { ...PRIOR_WEIGHTS },
        bias: 0,
        featureStats: seedFeatureStats(),
        sampleCount: 0,
        updatedAt: Date.now()
      };
      this.models.set(contextKey, model);
    }
    return ContextEngine.repair(model);
  }

  /**
   * Welford running normalization: z = (x - mean) / std, clamped to ±3.
   *
   * Gardul pe valori ne-finite e un bug real gasit de auditul QA. O SINGURA
   * valoare NaN/Infinity intr-un feature (un camp lipsa/corupt pe o
   * AnalysisRecord veche, un numar invalid intors de un plugin nativ) nu
   * ramanea locala: intra in `z` prin suma ponderata, deci `probability`
   * devenea NaN, `score` devenea NaN, si de acolo mai departe —
   *   - decidePhotoStatus(NaN) cadea pe 'review' pentru ORICE prag (ambele
   *     comparatii cu NaN sunt false), deci poza nu mai putea fi decisa
   *     automat niciodata;
   *   - `aiScore: NaN` era scris in db.analyses, unde `aiScore` e camp
   *     INDEXAT — IndexedDB nu accepta NaN drept cheie, deci inregistrarea
   *     dispare tacut din index: readLibraryScores() (care alimenteaza
   *     deriveThresholds pentru TOT lotul urmator) n-o mai vede, iar orice
   *     sortare/filtrare dupa scor o trateaza ca inexistenta.
   * Mai rau, statisticile Welford se contaminau si ele permanent (mean/m2
   * devin NaN dupa un singur update cu NaN), otravind contextul pentru toate
   * pozele viitoare, nu doar pentru cea corupta.
   *
   * Un feature nemasurabil trebuie sa fie NEUTRU (z = 0, contributie zero) —
   * acelasi principiu ca restul campurilor optionale din AnalysisRecord — nu
   * sa scoata din functiune scorarea intregii poze si a contextului ei.
   */
  private normalize(model: ContextModelRecord, features: FeatureVector, update: boolean): FeatureVector {
    const out: FeatureVector = {};
    for (const [k, raw] of Object.entries(features)) {
      if (!Number.isFinite(raw)) { out[k] = 0; continue; }
      const x = raw;
      let s: FeatureStat = model.featureStats[k] ?? { mean: 0, m2: 0, n: 0 };
      if (update) {
        s = { ...s, n: s.n + 1 };
        const delta = x - s.mean;
        s.mean += delta / s.n;
        s.m2 += delta * (x - s.mean);
        model.featureStats[k] = s;
      }
      const variance = s.n > 1 ? s.m2 / (s.n - 1) : 1;
      const std = Math.sqrt(Math.max(variance, 1e-4));
      const z = s.n > 2 ? (x - s.mean) / std : x; // raw until stats warm up
      out[k] = Math.max(-3, Math.min(3, z));
    }
    return out;
  }
}

export const contextEngine = new ContextEngine();
