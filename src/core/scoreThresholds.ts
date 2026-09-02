/**
 * core/scoreThresholds.ts
 * Cat de sigur trebuie sa fie motorul ca sa decida SINGUR, in loc sa te intrebe.
 *
 * Pragurile fixe (65 selectat / 35 respins) presupun ca scorul e calibrat: "65"
 * ar trebui sa insemne "65% sanse sa tii poza asta". In practica scorul e o
 * sigmoida peste feature-uri normalizate pe biblioteca TA, si distributia lui
 * depinde mult de ce fotografiezi. Doua cazuri degenerate, ambele plauzibile:
 *
 *  - o sesiune intreaga in interior, seara: nimic nu trece de 65, aplicatia
 *    propune ZERO poze si trebuie sa treci manual prin tot — exact munca pe
 *    care ar fi trebuit s-o scuteasca;
 *  - o vacanta insorita, poze bune: aproape tot trece de 65, nimic nu se
 *    respinge, si triajul n-a redus nimic.
 *
 * Ce face acest modul: pastreaza pragurile absolute EXACT cum sunt cat timp
 * produc un rezultat rezonabil, si le muta doar cand ar produce unul din cele
 * doua cazuri degenerate de mai sus. Judecata absoluta de calitate ramane deci
 * regula, iar distributia e doar plasa de siguranta — nu invers. O biblioteca
 * de poze excelente NU incepe sa respinga 20% doar ca sa umple o cota, si una
 * de poze slabe nu incepe sa selecteze automat cea mai putin proasta.
 *
 * Deplasarea e in plus PLAFONATA la o banda ingusta in jurul valorilor fixe:
 * chiar in cazul cel mai degenerat, pragul de selectie nu coboara sub 55 si nu
 * urca peste 78. Cele doua benzi nu se pot intersecta (45 < 55), deci zona de
 * "revizuieste tu" nu poate disparea niciodata.
 *
 * Fara dependinte (nici db.ts): matematica se testeaza direct pe un vector de
 * scoruri, iar citirea din IndexedDB sta in apelant.
 */

/** Pragurile de referinta, folosite cat timp nimic nu indica o problema. */
export const SELECT_THRESHOLD = 65;
export const REJECT_THRESHOLD = 35;

/**
 * Sub atatea poze scorate nu adaptam nimic: cu 40 de poze, "5% peste prag" e
 * doua poze, adica zgomot, iar o plasa de siguranta care se declanseaza pe
 * zgomot e mai rea decat niciuna.
 */
export const MIN_SCORES_FOR_ADAPTATION = 150;

/**
 * Fractiunea de biblioteca decisa automat (de fiecare parte) considerata
 * sanatoasa. Intre aceste limite pragurile fixe raman NEATINSE.
 */
const MIN_HEALTHY_FRACTION = 0.06;
const MAX_HEALTHY_FRACTION = 0.5;
/** Cand am iesit din banda sanatoasa, tinta spre care mutam pragul. */
const TARGET_FRACTION = 0.2;

/** Cat de departe de valoarea fixa poate ajunge fiecare prag, in cazul cel mai degenerat. */
const SELECT_MIN = 55, SELECT_MAX = 78;
const REJECT_MIN = 22, REJECT_MAX = 45;

export interface Thresholds {
  select: number;
  reject: number;
  /** true cand distributia chiar a mutat cel putin un prag — pentru explicatii in UI si pentru teste. */
  adapted: boolean;
}

export const FIXED_THRESHOLDS: Thresholds = { select: SELECT_THRESHOLD, reject: REJECT_THRESHOLD, adapted: false };

/**
 * Cat de exigent vrea UTILIZATORUL sa fie motorul — singurul lucru din acest
 * fisier pe care nu-l decide matematica, ci omul.
 *
 * De ce exista, dupa ce ne uitasem la concurenta: la Aftershoot, alegerea
 * nivelului de severitate e functia-titlu, iar reclamatia care se repeta in
 * recenziile TUTUROR uneltelor de culling e ca AI-ul taie prea mult ("closed-eye
 * detection is aggressive", "flagged sharp photos as blurry"). Aplicatia asta
 * isi muta deja pragurile singura cand distributia o cere (vezi deriveThresholds),
 * dar aia raspunde la intrebarea "e stricat ceva?", nu la "asa vreau eu".
 * Un utilizator convins ca motorul e prea aspru n-avea nicio parghie.
 *
 * 'balanced' e IDENTIC cu comportamentul de pana acum, bit cu bit — cine nu
 * atinge setarea nu vede nicio schimbare.
 */
export type CullingStrictness = 'lax' | 'balanced' | 'strict';

/**
 * Cate puncte se muta AMANDOUA pragurile, in sus la 'strict' si in jos la 'lax'.
 *
 * In sus la strict inseamna: mai greu de intrat in "pastrate" (pragul de
 * selectie urca) SI mai usor de picat in "respinse" (pragul de respingere urca
 * si el, deci mai multe poze raman sub el). Cele doua merg in aceeasi directie
 * fiindca descriu acelasi lucru — cat de usor multumesti motorul — nu doua
 * reglaje independente.
 *
 * 8 puncte, nu 20: pe pragurile fixe (65/35) asta inseamna 57/27 la ingaduitor
 * si 73/43 la sever. Destul cat sa se vada pe o biblioteca reala, prea putin
 * cat sa transforme setarea intr-un intrerupator "totul/nimic".
 */
const STRICTNESS_SHIFT = 8;

/**
 * Limitele pentru pragurile alese DE UTILIZATOR, mai largi decat cele ale
 * adaptarii automate (SELECT_MIN/MAX de mai sus).
 *
 * Adaptarea automata e o plasa de siguranta care se declanseaza singura, deci
 * trebuie sa fie prudenta. Asta e o alegere explicita, asumata, si n-are de ce
 * sa fie tinuta in aceeasi cusca — altfel, pe o biblioteca unde adaptarea a dus
 * deja pragul la maximul ei, "sever" n-ar face absolut nimic, iar setarea ar
 * parea stricata.
 */
const USER_SELECT_MIN = 50, USER_SELECT_MAX = 85;
const USER_REJECT_MIN = 18, USER_REJECT_MAX = 50;

/**
 * Banda "de verificat" nu are voie sa dispara, oricat de departe ar impinge
 * cineva setarea: intre praguri raman mereu cel putin atatea puncte. Fara
 * asta, o combinatie de adaptare + severitate putea sa suprapuna pragurile,
 * si aplicatia ar fi decis singura absolut totul — exact opusul promisiunii
 * ca tu ramai cel care alege.
 */
const MIN_REVIEW_BAND = 10;

/** Pragurile de mai sus, dupa ce se aplica alegerea utilizatorului. */
export function applyStrictness(base: Thresholds, strictness: CullingStrictness): Thresholds {
  if (strictness === 'balanced') return base;
  const shift = strictness === 'strict' ? STRICTNESS_SHIFT : -STRICTNESS_SHIFT;
  const select = clamp(base.select + shift, USER_SELECT_MIN, USER_SELECT_MAX);
  // Respingerea se plafoneaza si fata de selectie, nu doar fata de limita ei
  // absoluta — vezi MIN_REVIEW_BAND.
  const reject = clamp(base.reject + shift, USER_REJECT_MIN, Math.min(USER_REJECT_MAX, select - MIN_REVIEW_BAND));
  return { select, reject, adapted: base.adapted };
}


function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Cate valori dintr-un vector SORTAT crescator sunt >= s (cautare binara). */
function countAtOrAbove(sorted: number[], s: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] >= s) hi = mid; else lo = mid + 1;
  }
  return sorted.length - lo;
}

/** Cate valori dintr-un vector SORTAT crescator sunt <= s. */
function countAtOrBelow(sorted: number[], s: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] > s) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/**
 * Pragurile de folosit pentru aceasta biblioteca.
 *
 * @param sortedScores TOATE scorurile AI din biblioteca, sortate crescator
 *   (asa cum le da un index Dexie pe `aiScore` — vezi readLibraryScores).
 */
export function deriveThresholds(sortedScores: number[]): Thresholds {
  if (sortedScores.length < MIN_SCORES_FOR_ADAPTATION) return FIXED_THRESHOLDS;
  const n = sortedScores.length;

  let select = SELECT_THRESHOLD;
  const selectedFraction = countAtOrAbove(sortedScores, SELECT_THRESHOLD) / n;
  if (selectedFraction < MIN_HEALTHY_FRACTION || selectedFraction > MAX_HEALTHY_FRACTION) {
    // scorul de la care in sus se afla exact TARGET_FRACTION din biblioteca
    select = clamp(sortedScores[Math.min(n - 1, Math.floor(n * (1 - TARGET_FRACTION)))], SELECT_MIN, SELECT_MAX);
  }

  let reject = REJECT_THRESHOLD;
  const rejectedFraction = countAtOrBelow(sortedScores, REJECT_THRESHOLD) / n;
  if (rejectedFraction < MIN_HEALTHY_FRACTION || rejectedFraction > MAX_HEALTHY_FRACTION) {
    reject = clamp(sortedScores[Math.max(0, Math.ceil(n * TARGET_FRACTION) - 1)], REJECT_MIN, REJECT_MAX);
  }

  return { select, reject, adapted: select !== SELECT_THRESHOLD || reject !== REJECT_THRESHOLD };
}
