/**
 * state/genreAsked.ts
 *
 * Daca omul a raspuns deja (sau a refuzat sa raspunda) la intrebarea despre
 * genul sedintei.
 *
 * De ce e separata de `genre` insusi: "n-am ales niciun gen" si "am ales
 * dinadins niciunul" arata identic in state/genre.ts — amandoua sunt sirul gol.
 * Fara distinctia asta, cine apasa "Sari peste" ar fi intrebat din nou la
 * fiecare deschidere a aplicatiei, ceea ce transforma o intrebare utila in
 * ceva de care scapi.
 */
const STORAGE_KEY = 'lumin-genre-asked';

export function wasGenreAsked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGenreAsked(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // stocare indisponibila — intrebarea reapare la urmatoarea pornire, si atat
  }
}
