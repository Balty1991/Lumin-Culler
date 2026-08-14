/**
 * core/activeElapsed.ts
 * Cronometru care numara DOAR timpul in care aplicatia a fost efectiv in
 * prim-plan.
 *
 * Bug real raportat de utilizator, cu doua capturi la 5 minute distanta:
 * la 155/839 scria "~23m ramase", la 162/839 scria "~41m ramase". Timpul
 * ramas CRESTEA in loc sa scada. Nu era o eroare de aritmetica — in cele 5
 * minute aplicatia fusese minimizata, Android suspendase WebView-ul si se
 * procesasera 7 poze. Estimarea imparte timpul scurs la pozele terminate, iar
 * timpul acela includea si suspendarea, deci rata parea de zece ori mai proasta
 * decat era.
 *
 * Ce masuram de fapt: cat a lucrat aplicatia, nu cat a trecut pe ceas. Asta e si
 * singura marime din care se poate estima onest cat mai dureaza, pentru ca
 * nimeni nu poate sti dinainte cat va mai tine utilizatorul telefonul minimizat.
 *
 * Fara dependinte de DOM: `now` si vizibilitatea vin de la apelant, deci se
 * poate testa direct, fara jsdom si fara ceas fals.
 */

export interface ActiveElapsed {
  /** De marcat la fiecare schimbare de vizibilitate. Apelurile redundante sunt ignorate. */
  setVisible(visible: boolean, at: number): void;
  /** Milisecunde acumulate cat timp aplicatia a fost vizibila. */
  elapsedMs(at: number): number;
}

export function createActiveElapsed(startVisible: boolean, startedAt: number): ActiveElapsed {
  let accumulated = 0;
  /** Momentul de la care curge intervalul vizibil in desfasurare; null cand e ascunsa. */
  let since: number | null = startVisible ? startedAt : null;

  return {
    setVisible(visible, at) {
      if (visible === (since !== null)) return;
      if (visible) {
        since = at;
        return;
      }
      accumulated += Math.max(0, at - (since ?? at));
      since = null;
    },
    elapsedMs(at) {
      return accumulated + (since === null ? 0 : Math.max(0, at - since));
    }
  };
}
