/**
 * core/momentComparison.ts
 * "Mai clara decat celelalte patru cadre."
 *
 * Explicatiile de pana acum descriau poza in sine: cat de clara e, cum e
 * expusa, cine e in ea. Corecte, dar nu asa gandeste omul cand are in fata o
 * rafala. Acolo intrebarea nu e "e buna poza asta?", ci "e cea mai buna dintre
 * astea patru?" — si raspunsul la ea e singurul care chiar ajuta la decizie.
 *
 * Ce face modulul: compara o poza cu SURORILE ei din aceeasi serie si intoarce
 * o singura propozitie, doar cand are ce spune. Pragurile de mai jos exista ca
 * sa nu afirme o diferenta care nu se vede: intre doua cadre cu claritatea 71
 * si 73 nu e nimic de spus, iar a spune ceva oricum ar transforma explicatia
 * intr-un zgomot in care nu mai poti avea incredere.
 *
 * Fara i18n si fara store: intoarce o CHEIE si numerele ei, iar textul se
 * traduce in apelant.
 */

/** Sub atata diferenta de claritate, cele doua cadre arata la fel. */
const CLARITY_MARGIN = 12;

export interface MomentFrame {
  id: string;
  sharpness: number;
  faceCount: number;
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;
}

export interface MomentVerdict {
  key: 'sharpest' | 'softerThanSibling' | 'onlyEyesOpen';
  /** Cate cadre are momentul, cu tot cu poza insasi. */
  frames: number;
}

function eyesOpenFraction(f: MomentFrame): number {
  return f.groupEyesOpenRatio ?? (f.allEyesOpen ? 1 : 0);
}

/**
 * @param photo cadrul despre care vorbim
 * @param moment TOATE cadrele seriei, inclusiv `photo`
 */
export function compareWithinMoment(photo: MomentFrame, moment: MomentFrame[]): MomentVerdict | null {
  const others = moment.filter(f => f.id !== photo.id);
  if (others.length === 0) return null;
  const frames = others.length + 1;

  // Ochii inchisi sunt lucrul pe care omul il cauta primul intr-o rafala, si
  // singurul defect din serie care nu se poate repara nicicum — deci trece
  // inaintea claritatii cand poza asta e singura scapata.
  if (photo.faceCount > 0 && eyesOpenFraction(photo) === 1 && others.every(o => eyesOpenFraction(o) < 1)) {
    return { key: 'onlyEyesOpen', frames };
  }

  const bestOther = Math.max(...others.map(o => o.sharpness));
  if (photo.sharpness >= bestOther + CLARITY_MARGIN) return { key: 'sharpest', frames };
  if (bestOther >= photo.sharpness + CLARITY_MARGIN) return { key: 'softerThanSibling', frames };

  // Cadre practic identice: nu inventam o diferenta ca sa avem ce scrie.
  return null;
}
