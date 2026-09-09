/**
 * state/returnVisit.ts
 * Ce merita spus omului care deschide aplicatia A DOUA oara.
 *
 * Auditul de dinaintea lansarii, despre a doua sesiune: "complet goala. Nimic
 * care sa spuna ce s-a schimbat sau ce merita facut acum." Avea dreptate —
 * memento-ul de reimport (state/importReminder.ts) apare abia dupa
 * PAISPREZECE zile, si e facut pentru cine a uitat de aplicatie, nu pentru
 * cine se intoarce a doua zi.
 *
 * Modulul asta raspunde la o singura intrebare, cu un singur rand: din tot ce
 * s-a schimbat de la ultima vizita, care e lucrul cel mai util de spus ACUM.
 * Nu o lista de noutati — un rand, si o usa.
 *
 * Nu cere nicio permisiune noua si nu citeste nimic in plus: toate cifrele de
 * mai jos sunt deja in memorie sau deja citite pentru alte carduri.
 *
 * Prima sesiune nu primeste nimic: acolo exista deja ecranul de bun venit, iar
 * "de la ultima vizita" n-ar avea de la ce sa plece.
 */

/** Momentul ultimei vizite, in localStorage. Se scrie la pornire, DUPA ce s-a citit. */
const LAST_VISIT_KEY = 'lumin-last-visit';

/** Sub atat, doua deschideri sunt aceeasi sesiune, nu o revenire. */
export const SAME_SESSION_MS = 30 * 60 * 1000;

export interface ReturnVisitInput {
  now: number;
  /** null = prima sesiune, sau stocare indisponibila. */
  lastVisitAt: number | null;
  /** Poze importate DUPA ultima vizita si inca nedecise. */
  importedSinceLastVisit: number;
  /** Tot ce a ramas de decis, indiferent cand a intrat. */
  undecided: number;
  /** Poze noi in galeria telefonului fata de semnul de carte; null = nu se stie (web, fara permisiune). */
  galleryNew: number | null;
}

export type ReturnVisitAction = 'sort' | 'import';

export interface ReturnVisitPrompt {
  key: string;
  params: Record<string, number>;
  action: ReturnVisitAction;
}

/**
 * Randul de aratat, sau null cand nu e nimic de spus.
 *
 * Ordinea nu e "cea mai mare cifra", ci "cel mai aproape de ce faceai":
 * pozele aduse si nedecise sunt munca inceputa, restul nedecis e munca amanata,
 * galeria noua e munca urmatoare. Streak-ul si recapul au deja cardurile lor.
 */
export function returnVisitPrompt(input: ReturnVisitInput): ReturnVisitPrompt | null {
  const { now, lastVisitAt, importedSinceLastVisit, undecided, galleryNew } = input;
  if (lastVisitAt === null) return null;
  if (now - lastVisitAt < SAME_SESSION_MS) return null;

  if (importedSinceLastVisit > 0) {
    return { key: 'returnVisit.newImported', params: { count: importedSinceLastVisit }, action: 'sort' };
  }
  if (undecided > 0) {
    return { key: 'returnVisit.leftOver', params: { count: undecided }, action: 'sort' };
  }
  if (galleryNew !== null && galleryNew > 0) {
    return { key: 'returnVisit.galleryNew', params: { count: galleryNew }, action: 'import' };
  }
  return { key: 'returnVisit.allClear', params: {}, action: 'import' };
}

export function readLastVisit(): number | null {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastVisit(now = Date.now()): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    // fara stocare, fiecare deschidere pare prima — randul lipseste, nu minte
  }
}
