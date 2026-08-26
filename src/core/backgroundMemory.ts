/**
 * core/backgroundMemory.ts
 *
 * Elibereaza memoria vizuala cand aplicatia nu mai e pe ecran.
 *
 * De ce exista: Google Play a anuntat pentru februarie 2027 praguri de calitate
 * pe memorie, iar unul dintre ele spune EXACT lucrul asta — bitmap-urile nu
 * trebuie tinute in memorie in starile in care aplicatia nu se vede (fundal,
 * cached). Aplicatia asta tine pana la 240 de adrese de miniaturi si 40 de
 * previzualizari, fiecare cu imaginea decodata in spate: pe o biblioteca mare,
 * zeci de megaocteti pe care sistemul ii numara si dupa ce ai minimizat-o.
 *
 * Nu se pierde nimic: adresele se refac din IndexedDB la urmatoarea afisare,
 * exact ca la prima deschidere. Costul e o singura citire de pe disc pentru
 * miniaturile revenite pe ecran; castigul e ca aplicatia nu mai e cea mai
 * grasa din lista cand sistemul cauta pe cine sa inchida.
 *
 * IMPORTANT, si de-aia exista intarzierea: `visibilitychange` se declanseaza si
 * cand omul doar comuta o secunda la alta aplicatie si se intoarce. Golirea
 * imediata ar fi insemnat, in cazul acela, o reincarcare completa a grilei fix
 * cand se uita la ea. Se asteapta putin; daca s-a intors, nu se mai goleste
 * nimic.
 */
import { clearPreviewUrlCache } from './previewUrlCache';
import { clearThumbUrlCache } from './thumbUrlCache';

/** Cat sta aplicatia ascunsa inainte sa merite golit cache-ul. */
export const BACKGROUND_RELEASE_DELAY_MS = 12_000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Extras ca sa poata fi testat fara `document` — vezi backgroundMemory.test.ts. */
export function onVisibilityChange(
  ascuns: boolean,
  elibereaza: () => void,
  delayMs: number = BACKGROUND_RELEASE_DELAY_MS
): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!ascuns) return;
  timer = setTimeout(() => {
    timer = null;
    elibereaza();
  }, delayMs);
}

/** Doar pentru teste: uita orice asteptare in curs. */
export function resetBackgroundMemory(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export function watchBackgroundMemory(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    onVisibilityChange(document.hidden, () => {
      clearPreviewUrlCache();
      clearThumbUrlCache();
    });
  });
}
