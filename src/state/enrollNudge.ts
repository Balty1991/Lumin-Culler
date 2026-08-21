/**
 * state/enrollNudge.ts
 * Cand merita sa-i spunem omului ca motorul ar sti mai multe daca i-ar spune
 * cine conteaza pentru el.
 *
 * De ce exista: cat timp nu e inrolat nimeni, motorul nu poate deosebi
 * persoana ta de un trecator. Nu mai penalizeaza pozele pentru asta (vezi
 * extractFeatures in learning/ContextEngine.ts, unde cele doua semnale lipsesc
 * din vector cat timp nu stim pe nimeni) — dar tot NU STIE. Iar ecranul de
 * Persoane exista si nimic nu te trimite acolo: trebuie sa-l descoperi singur.
 *
 * Reguli, ca sa nu fie inca un banner care se cere ignorat:
 *  - abia dupa ce omul a triat ceva. Un indemn la instalare e o cerinta pusa
 *    inainte sa se fi castigat vreun drept la ea;
 *  - doar daca biblioteca chiar are oameni in ea. Pe poze de peisaj sau
 *    documente, sfatul n-are niciun sens;
 *  - inchis definitiv, nu amanat: spre deosebire de backup sau de import,
 *    inrolarea e o actiune care se face O DATA. Un memento care revine dupa
 *    ce ai spus "nu" ar fi insistenta, nu ajutor.
 *
 * Fara dependinte: se testeaza direct pe numere.
 */
const DISMISSED_KEY = 'lumin-enroll-nudge-dismissed';

/** Sub atatea poze cu fete, biblioteca nu e (inca) una despre oameni. */
export const MIN_PHOTOS_WITH_FACES = 12;
/** Sub atatea decizii luate de om, inca nu si-a facut o parere despre aplicatie. */
export const MIN_DECISIONS = 15;

export interface EnrollNudgeInput {
  enrolledPersons: number;
  photosWithFaces: number;
  decidedPhotos: number;
  dismissed: boolean;
}

export function shouldShowEnrollNudge(input: EnrollNudgeInput): boolean {
  if (input.dismissed) return false;
  if (input.enrolledPersons > 0) return false;
  if (input.photosWithFaces < MIN_PHOTOS_WITH_FACES) return false;
  return input.decidedPhotos >= MIN_DECISIONS;
}

export function readEnrollNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeEnrollNudgeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // stocare indisponibila — indemnul revine la urmatoarea sesiune, si atat
  }
}
