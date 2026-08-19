/**
 * core/groupVerdict.ts
 *
 * De ce ACEST cadru din serie, si nu celalalt.
 *
 * Aplicatia explica deja foarte bine de ce o poza singura a primit scorul ei
 * (tabul "De ce acest scor", aiExplanationGenerator.ts). Dar decizia care chiar
 * sterge poze e alta: intr-un grup de cadre aproape identice, unul e pastrat si
 * restul se resping. Pana acum acel cadru primea doar o panglica si un scor —
 * niciun cuvant despre CE anume l-a facut castigator. Utilizatorul vede "89" si
 * "84" si trebuie sa deduca singur daca diferenta de 5 puncte inseamna ceva.
 *
 * Modulul de aici compara castigatorul cu restul grupului pe semnalele masurate
 * si intoarce motivele care chiar au decis, in ordinea in care conteaza pentru
 * un om: intai ochii (singurul defect pe care nimeni nu-l iarta intr-o poza de
 * grup), apoi claritatea, apoi zambetul, apoi expunerea. Scorul AI ramane
 * ultimul, ca plasa de siguranta — e o sinteza, nu o observatie.
 *
 * Cazul in care cadrele sunt cu adevarat echivalente NU e ascuns: `confidence`
 * devine 'low' si textul o spune pe fata. Un "le-am ales aproape la intamplare,
 * verifica tu" cinstit produce mai multa incredere decat un procent inventat.
 *
 * Fara DOM, fara store, fara i18n: intoarce chei si parametri, iar stratul de
 * interfata le traduce. Asa se poate testa direct si ramane la fel in RO si EN.
 */

/** Minimul din PhotoView de care are nevoie comparatia — vezi state/store.ts. */
export interface GroupMember {
  id: string;
  aiScore: number;
  sharpness: number;
  exposure: number;
  faceCount: number;
  allEyesOpen: boolean;
  bestSmile: number;
  groupEyesOpenRatio?: number;
  groupSmileRatio?: number;
}

export interface GroupReason {
  /** Cheie i18n, sub `groupVerdict.reason.*`. */
  key: string;
  params?: Record<string, string | number>;
}

export interface GroupVerdict {
  keptId: string;
  reasons: GroupReason[];
  /**
   * `high` — cel putin un motiv observabil (ochi/claritate/zambet/expunere).
   * `low`  — nimic nu le desparte vizibil; alegerea s-a facut pe scor, iar
   *          diferenta e mica. Interfata trebuie sa spuna asta, nu s-o ascunda.
   */
  confidence: 'high' | 'low';
}

/** Sub acest prag, o diferenta de claritate nu se vede cu ochiul liber pe telefon. */
export const SHARPNESS_GAP = 10;
/** Diferenta de zambet (0..1) de la care merita mentionata. */
export const SMILE_GAP = 0.15;
/** Cat de departe de expunerea ideala (50) trebuie sa fie un cadru ca sa conteze. */
export const EXPOSURE_DEVIATION = 15;
/** Diferenta de scor AI sub care grupul se considera "practic egal". */
export const SCORE_TIE = 4;

/** Cati ochi deschisi are cadrul, ca fractie 0..1. Fara fete, intrebarea nu se pune. */
function eyesOpenRatio(p: GroupMember): number | null {
  if (p.faceCount === 0) return null;
  if (p.faceCount > 1 && p.groupEyesOpenRatio !== undefined) return p.groupEyesOpenRatio;
  return p.allEyesOpen ? 1 : 0;
}

function smileRatio(p: GroupMember): number | null {
  if (p.faceCount === 0) return null;
  if (p.faceCount > 1 && p.groupSmileRatio !== undefined) return p.groupSmileRatio;
  return p.bestSmile;
}

/** Cat de departe e expunerea de mijloc; mai mic = mai echilibrat. */
function exposureError(p: GroupMember): number {
  return Math.abs(p.exposure - 50);
}

/**
 * Explica de ce `keptId` a fost ales din `members`.
 *
 * Intoarce `null` cand nu exista nimic de explicat: grup de un singur cadru,
 * sau castigatorul nu e in lista (stare imposibila in interfata, dar posibila
 * daca lista s-a filtrat intre timp).
 */
export function explainGroupChoice(members: GroupMember[], keptId: string): GroupVerdict | null {
  if (members.length < 2) return null;
  const kept = members.find(m => m.id === keptId);
  if (!kept) return null;
  const others = members.filter(m => m.id !== keptId);
  const reasons: GroupReason[] = [];

  // 1. Ochii. Primul si cel mai putin negociabil criteriu dintr-o serie de grup.
  const keptEyes = eyesOpenRatio(kept);
  if (keptEyes !== null) {
    const otherEyes = others.map(eyesOpenRatio).filter((v): v is number => v !== null);
    if (otherEyes.length) {
      const bestOther = Math.max(...otherEyes);
      if (keptEyes === 1 && bestOther < 1) {
        // Cazul cel mai clar: singura in care nu clipeste nimeni.
        reasons.push(others.length === 1
          ? { key: 'groupVerdict.reason.eyesOnlyOneOfTwo' }
          : { key: 'groupVerdict.reason.eyesOnlyOne' });
      } else if (keptEyes - bestOther >= 0.2) {
        reasons.push({
          key: 'groupVerdict.reason.eyesMore',
          params: { kept: Math.round(keptEyes * 100), other: Math.round(bestOther * 100) }
        });
      }
    }
  }

  // 2. Claritatea. Se vede imediat la marire, si e motivul pentru care un cadru
  //    dintr-o rafala e de pastrat si restul nu.
  const bestOtherSharp = Math.max(...others.map(o => o.sharpness));
  const sharpGap = kept.sharpness - bestOtherSharp;
  if (sharpGap >= SHARPNESS_GAP) {
    reasons.push({ key: 'groupVerdict.reason.sharper', params: { gap: Math.round(sharpGap) } });
  }

  // 3. Zambetul.
  const keptSmile = smileRatio(kept);
  if (keptSmile !== null) {
    const otherSmiles = others.map(smileRatio).filter((v): v is number => v !== null);
    if (otherSmiles.length) {
      const bestOther = Math.max(...otherSmiles);
      if (keptSmile - bestOther >= SMILE_GAP) {
        reasons.push({ key: 'groupVerdict.reason.smile', params: { kept: Math.round(keptSmile * 100) } });
      }
    }
  }

  // 4. Expunerea — doar cand celelalte chiar sunt gresit expuse, nu la orice
  //    diferenta de cateva puncte.
  const keptExpErr = exposureError(kept);
  const bestOtherExpErr = Math.min(...others.map(exposureError));
  if (keptExpErr + 8 <= bestOtherExpErr && bestOtherExpErr >= EXPOSURE_DEVIATION) {
    reasons.push({ key: 'groupVerdict.reason.exposure' });
  }

  if (reasons.length) return { keptId, reasons, confidence: 'high' };

  // Nimic observabil nu le desparte. Spunem exact asta, cu diferenta reala de
  // scor — inclusiv cand e zero.
  const bestOtherScore = Math.max(...others.map(o => o.aiScore));
  const scoreGap = kept.aiScore - bestOtherScore;
  if (scoreGap >= SCORE_TIE) {
    return { keptId, reasons: [{ key: 'groupVerdict.reason.score', params: { gap: Math.round(scoreGap) } }], confidence: 'high' };
  }
  return {
    keptId,
    reasons: [{ key: 'groupVerdict.reason.tooClose', params: { gap: Math.round(Math.max(0, scoreGap)) } }],
    confidence: 'low'
  };
}
