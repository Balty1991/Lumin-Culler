/**
 * state/reviewPrompt.ts
 * CAND ii cerem omului o nota in Google Play — o singura data, la momentul
 * potrivit. Mecanica e in core/inAppReview.ts.
 *
 * DE CE. Aplicatia a iesit in productie cu zero note, iar fara note Play n-o
 * arata in cautari. Pana acum, cine voia sa lase o nota trebuia sa iasa din
 * aplicatie si sa caute fisa.
 *
 * MOMENTUL: primul export reusit de cel putin MIN_EXPORTED_FOR_REVIEW poze.
 * Atunci omul chiar a scos ceva util din aplicatie — pozele pe care a decis sa
 * le pastreze —, deci are pe ce isi forma o parere. Nu la prima pornire, nu in
 * mijlocul unui import, nu dupa trei poze.
 *
 * O SINGURA DATA, marcat INAINTE de cerere. Daca s-ar marca dupa, o cadere a
 * aplicatiei intre cele doua ar face-o sa intrebe din nou la urmatorul export —
 * exact felul de insistenta care strica notele in loc sa le aduca. Google isi
 * aplica oricum si propria cota; a noastra e mai stricta.
 *
 * FARA NICIO INTREBARE INAINTE ("Iti place?") si fara nicio recompensa: ambele
 * sunt interzise de politica Play, si ar face notele primite sa nu insemne
 * nimic.
 */
import { requestInAppReview, isInAppReviewAvailable } from '../core/inAppReview';

const ASKED_KEY = 'lumin-review-asked-at';

/**
 * Sub atatea poze exportate nu intrebam. Un export de trei poze e un test, nu
 * o sesiune de triat terminata.
 */
export const MIN_EXPORTED_FOR_REVIEW = 10;

/**
 * Cat asteptam dupa export inainte sa cerem fereastra. Omul trebuie sa apuce
 * sa vada confirmarea exportului; o fereastra Play aparuta peste ea arata ca o
 * reclama, nu ca o intrebare.
 */
export const REVIEW_DELAY_MS = 1500;

/**
 * S-a mai intrebat pe dispozitivul asta? Stocarea indisponibila se citeste ca
 * DA: fara memorie, n-am avea cum sa stim ca n-am intrebat deja, iar a intreba
 * la fiecare export e mai rau decat a nu intreba deloc.
 */
export function readReviewAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) !== null;
  } catch {
    return true;
  }
}

function markReviewAsked(now: number): void {
  try { localStorage.setItem(ASKED_KEY, String(now)); } catch { /* vezi readReviewAsked */ }
}

export function shouldAskForReview(opts: { available: boolean; asked: boolean; exported: number }): boolean {
  return opts.available && !opts.asked && opts.exported >= MIN_EXPORTED_FOR_REVIEW;
}

/**
 * Asteapta pana cand aplicatia e pe ecran, apoi inca REVIEW_DELAY_MS.
 *
 * Un export catre "alte aplicatii" deschide foaia de partajare a sistemului;
 * cand promisiunea exportului se incheie, omul poate fi deja in alta aplicatie.
 * O fereastra de recenzie ceruta atunci ori nu apare, ori apare peste altceva.
 */
function laUrmatoareaVedere(fn: () => void): void {
  if (typeof document === 'undefined') return;
  const cand = () => {
    setTimeout(() => { if (document.visibilityState === 'visible') fn(); }, REVIEW_DELAY_MS);
  };
  if (document.visibilityState === 'visible') { cand(); return; }
  const laIntoarcere = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', laIntoarcere);
    cand();
  };
  document.addEventListener('visibilitychange', laIntoarcere);
}

/** De chemat dupa fiecare export reusit. Decide singur daca intreaba. */
export function maybeAskForReview(exported: number, now: number = Date.now()): void {
  if (!shouldAskForReview({ available: isInAppReviewAvailable(), asked: readReviewAsked(), exported })) return;
  markReviewAsked(now);
  laUrmatoareaVedere(() => { void requestInAppReview(); });
}
