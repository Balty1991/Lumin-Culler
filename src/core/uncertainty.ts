/**
 * core/uncertainty.ts
 * "Verifică ce nu știu sigur" — cele câteva poze pe care motorul le-a decis
 * singur, dar aproape la limită.
 *
 * Ideea, in doua propozitii: scorul AI e o PROBABILITATE (vezi
 * ContextEngine.predict), nu o nota. Un 92 sau un 8 inseamna "sunt aproape
 * sigur"; un 63 sau un 38 inseamna "am dat cu banul si a iesit pe partea asta"
 * — chiar daca amandoua au trecut de un prag si au primit o decizie automata.
 *
 * De ce merita un flux propriu, si nu doar sortare dupa scor:
 *
 * 1. SIGURANTA. Frica reala la culling nu e "am pastrat o poza slaba", ci "am
 *    aruncat una buna". Greselile nu sunt raspandite uniform: se aduna exact
 *    langa prag. Verificand 12 poze de acolo prinzi majoritatea deciziilor
 *    gresite, in loc sa treci prin toate cele 400.
 *
 * 2. INVATARE. In invatarea activa, exemplele de langa granita de decizie sunt
 *    cele mai informative — o corectie acolo muta modelul mult mai mult decat
 *    una pe o poza evidenta, unde oricum prezicea corect. Aceleasi 12 decizii
 *    antreneaza motorul mai repede decat 50 luate la intamplare.
 *
 * Adica un singur gest care serveste si teama utilizatorului, si viteza de
 * adaptare a motorului — doua lucruri care de obicei se bat cap in cap.
 *
 * Fara dependinte (nici db.ts): tot ce e aici e pur si testabil direct.
 */

/** Cate poze propunem la o runda — destule cat sa prinda tiparul, putine cat sa fie o pauza de un minut, nu inca o sesiune de triaj. */
export const UNCERTAIN_BATCH = 12;

/**
 * Sub atata nesiguranta nu merita deranjat nimeni.
 *
 * 0.5 inseamna un scor intre 25 si 75. Pare larg, dar nu e: aici ajung DOAR
 * poze deja decise automat, iar acelea sunt prin definitie dincolo de pragurile
 * de decizie (in mod normal 65/35, vezi core/scoreThresholds.ts). Intersectia
 * celor doua conditii lasa exact benzile 65..75 si 25..35 — pozele decise la
 * limita, si nimic altceva. O poza de 90 sau de 8 nu are ce cauta aici.
 */
export const MIN_UNCERTAINTY = 0.5;

/**
 * Cat de nesigur a fost motorul, 0..1. Maxim (1) la scor 50 — aruncare de
 * moneda; minim (0) la 0 sau 100, unde raspunsul e clar.
 */
export function uncertainty(aiScore: number): number {
  const clamped = Math.max(0, Math.min(100, aiScore));
  return 1 - Math.abs(clamped - 50) / 50;
}

export interface UncertainCandidate {
  id: string;
  aiScore: number;
  /** Doar deciziile AUTOMATE conteaza — vezi pickMostUncertain. */
  status: 'selected' | 'rejected' | 'review' | string;
}

/**
 * Pozele de propus spre verificare, cele mai nesigure primele.
 *
 * Doua excluderi, amandoua deliberate:
 *
 * - status 'review': aceste poze asteapta oricum decizia ta, deci nu e nimic de
 *   "prins" acolo — nicio decizie automata nu poate fi gresita daca nu s-a luat
 *   niciuna.
 * - poze pe care le-ai decis deja tu (`decided`): a te intreba a doua oara
 *   despre o poza pe care ai judecat-o deja nu-ti da nimic, si nici modelului —
 *   corectia ta e deja invatata.
 */
export function pickMostUncertain(
  candidates: readonly UncertainCandidate[],
  decided: ReadonlySet<string>,
  limit = UNCERTAIN_BATCH
): string[] {
  return candidates
    .filter(c => (c.status === 'selected' || c.status === 'rejected') && !decided.has(c.id))
    .map(c => ({ id: c.id, u: uncertainty(c.aiScore) }))
    .filter(c => c.u >= MIN_UNCERTAINTY)
    // descrescator dupa nesiguranta; la egalitate, ordinea de intrare (stabila)
    .sort((a, b) => b.u - a.u)
    .slice(0, Math.max(0, limit))
    .map(c => c.id);
}
