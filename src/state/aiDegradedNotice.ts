/**
 * state/aiDegradedNotice.ts
 *
 * Daca omul a inchis deja anuntul "analiza merge fara fete" pe acest telefon.
 *
 * De ce e nevoie de el: anuntul apare exact cand utilizatorul incearca prima
 * data functia principala, si ramanea acolo permanent, cu pictograma de
 * avertisment, enumerand ce NU merge. Un banner de alerta care nu poate fi
 * inchis si care nu poate fi rezolvat de nimeni nu mai informeaza — doar spune,
 * la fiecare deschidere, ca produsul e limitat.
 *
 * Nu e o setare, ci o confirmare de citire: se pastreaza pe telefonul asta si
 * atat. Daca se schimba ceva la accelerare (alt browser, alta versiune de
 * sistem, alt backend), cheia e alta si anuntul revine o data — pentru ca atunci
 * chiar e informatie noua.
 */
const STORAGE_KEY = 'lumin-ai-degraded-seen';

export function isAiDegradedNoticeDismissed(backend: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === backend;
  } catch {
    return false;
  }
}

export function dismissAiDegradedNotice(backend: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, backend);
  } catch {
    // stocare indisponibila — anuntul se inchide pentru sesiunea curenta si atat
  }
}
