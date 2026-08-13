/**
 * core/sessionOutcome.ts
 * Ce s-a întâmplat de fapt, spus imediat după ce s-a întâmplat.
 *
 * Aplicatia face o cantitate mare de munca la fiecare import — scoreaza fiecare
 * poza, strange seriile, decide singura marea majoritate — si pana acum nu spunea
 * NIMIC despre asta. Bara de progres disparea, aparea o grila de poze, si atat.
 * Toate cifrele existau (StatsPanel le arata), dar intr-un panou pe care trebuie
 * sa-l cauti singur intr-un meniu, la un moment ales de tine — adica exact
 * atunci cand nu mai simti efortul pe care tocmai l-ai evitat.
 *
 * Momentul in care un utilizator isi da seama daca o unealta merita ceva e
 * imediat dupa ce ea a lucrat, nu cu doua zile mai tarziu intr-un ecran de
 * statistici.
 *
 * ONESTITATE, si e principala regula a acestui modul: NU inventam "ti-am
 * economisit 50 de minute". N-avem de unde sti cat de repede ai fi triat manual,
 * si o cifra inventata ar fi observata exact de utilizatorii pe care vrem sa-i
 * convingem. Spunem doar ce s-a masurat: cate poze ai de verificat din cate ai
 * adus. Economia de timp e evidenta din raportul acela, si o deduce cititorul
 * singur — ceea ce o face credibila.
 *
 * Fara dependinte: pur, testabil direct.
 */

export interface SessionOutcomeInput {
  /** Cate poze au intrat efectiv in acest lot. */
  imported: number;
  /** Cate au primit o decizie automata (selectate + respinse). */
  autoDecided: number;
  /** Cate serii/duplicate au fost strunse in grupuri in acest lot. */
  seriesFound: number;
  durationMs: number;
}

export interface SessionOutcome {
  imported: number;
  autoDecided: number;
  /** Cate raman de verificat de tine. */
  leftToReview: number;
  /** Fractiunea din lot pe care nu mai trebuie s-o atingi, 0..1. */
  handledShare: number;
  seriesFound: number;
  durationMs: number;
}

/**
 * Rezultatul lotului, sau null cand nu e nimic de raportat (lot gol).
 *
 * `autoDecided` e plafonat la `imported`: cifrele vin din doua surse (contorul
 * importului si statusurile recitite din baza dupa gruparea seriilor), iar un
 * raport care ar anunta "413 decise din 412" ar distruge increderea in TOATE
 * celelalte cifre de pe ecran — chiar daca ar fi doar o nepotrivire de o poza.
 */
export function summarizeSession(input: SessionOutcomeInput): SessionOutcome | null {
  if (input.imported <= 0) return null;
  const autoDecided = Math.max(0, Math.min(input.imported, input.autoDecided));
  return {
    imported: input.imported,
    autoDecided,
    leftToReview: input.imported - autoDecided,
    handledShare: autoDecided / input.imported,
    seriesFound: Math.max(0, input.seriesFound),
    durationMs: Math.max(0, input.durationMs)
  };
}
