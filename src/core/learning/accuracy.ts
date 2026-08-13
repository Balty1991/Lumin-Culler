/**
 * core/learning/accuracy.ts
 * "Cât de bine te cunosc" — cat de des a avut dreptate motorul, spus onest.
 *
 * Fiecare decizie manuala scrie un CorrectionRecord cu DOUA campuri: ce
 * propunea AI-ul (`aiDecision`) si ce ai ales tu (`userDecision`). Adica exista
 * deja, de la inceput, un set complet de raspunsuri corecte — nefolosit vreodata
 * pentru altceva decat antrenare.
 *
 * De ce merita aratat: o aplicatie care decide in locul tau iti cere incredere,
 * si de obicei o cere fara sa ofere nimic verificabil in schimb ("AI avansat",
 * "analiza inteligenta"). Aici putem spune exact: din 100 de poze propuse spre
 * pastrare, ai pastrat 87. Numarul poate fi si prost — asta e ideea. Un
 * indicator care nu poate arata rau nu e un indicator, e o reclama.
 *
 * Ce NU e: o masura a calitatii pozelor tale, si nici o nota de examen. E
 * acordul dintre doua opinii, masurat doar pe pozele pe care le-ai judecat chiar
 * tu — pozele lasate in seama AI-ului nu apar aici deloc, tocmai pentru ca
 * nimeni nu le-a verificat.
 *
 * Fara dependinte (nici db.ts): matematica se testeaza direct pe o lista de
 * inregistrari.
 */

/** Sub atatea decizii judecate de tine, orice procent e zgomot — nu aratam nimic. */
export const MIN_DECISIONS_FOR_ACCURACY = 20;

/** Cate decizii intra in fereastra "recent", pentru comparatia cu inceputul. */
export const RECENT_WINDOW = 50;

export interface AccuracyInput {
  aiDecision: boolean;
  userDecision: boolean;
  ts: number;
}

export interface AccuracySummary {
  /** Cate decizii ale tale au stat la baza cifrelor de mai jos. */
  total: number;
  /** Din pozele propuse spre PASTRARE, fractiunea pe care ai pastrat-o (0..1). null cand n-a propus niciuna. */
  keepPrecision: number | null;
  /** Din pozele puse DEOPARTE, fractiunea pe care chiar ai respins-o (0..1). null cand n-a pus niciuna. */
  rejectPrecision: number | null;
  /** Acordul general, 0..1. */
  agreement: number;
  /**
   * Acordul pe ultimele RECENT_WINDOW decizii fata de cele dinaintea lor —
   * null cand inca nu exista doua ferestre pline de comparat. Asta e singura
   * cifra care arata daca motorul chiar se ADAPTEAZA la tine, nu doar cat de
   * bine a nimerit-o in medie de la inceput.
   */
  trend: { recent: number; earlier: number } | null;
}

function agreementOf(rows: readonly AccuracyInput[]): number {
  if (!rows.length) return 0;
  return rows.filter(r => r.aiDecision === r.userDecision).length / rows.length;
}

/**
 * @param corrections Toate deciziile manuale, in orice ordine — sortate aici
 *   dupa timp, fiindca `trend` are nevoie de "ultimele" si "cele dinainte".
 */
export function summarizeAccuracy(corrections: readonly AccuracyInput[]): AccuracySummary | null {
  if (corrections.length < MIN_DECISIONS_FOR_ACCURACY) return null;
  const rows = [...corrections].sort((a, b) => a.ts - b.ts);

  const proposedKeep = rows.filter(r => r.aiDecision);
  const proposedReject = rows.filter(r => !r.aiDecision);

  // Doua ferestre pline, si care nu se suprapun — altfel "tendinta" ar compara
  // partial aceleasi decizii cu ele insele si ar arata mereu o miscare mica.
  const trend = rows.length >= RECENT_WINDOW * 2
    ? {
        recent: agreementOf(rows.slice(-RECENT_WINDOW)),
        earlier: agreementOf(rows.slice(-RECENT_WINDOW * 2, -RECENT_WINDOW))
      }
    : null;

  return {
    total: rows.length,
    keepPrecision: proposedKeep.length ? proposedKeep.filter(r => r.userDecision).length / proposedKeep.length : null,
    rejectPrecision: proposedReject.length ? proposedReject.filter(r => !r.userDecision).length / proposedReject.length : null,
    agreement: agreementOf(rows),
    trend
  };
}
