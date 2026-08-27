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

/**
 * Cat sta aplicatia ascunsa inainte sa merite golit cache-ul.
 *
 * Scazut de la 12s la 4s dupa citirea cerintei Play: esantionarea memoriei se
 * face LA SCURT TIMP dupa schimbarea de stare, deci o asteptare lunga inseamna
 * ca ne masoara exact inainte sa eliberam. Patru secunde tot acopera comutarea
 * scurta la alta aplicatie (motivul pentru care exista intarzierea), fara sa
 * ratam fereastra de masurare.
 *
 * Pe Android drumul asta e oricum doar rezerva: acolo soseste `luminTrimMemory`
 * de la sistem (vezi onTrimMemory in MainActivity) si se elibereaza IMEDIAT.
 */
export const BACKGROUND_RELEASE_DELAY_MS = 4_000;

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

function elibereaza(): void {
  clearPreviewUrlCache();
  clearThumbUrlCache();
}

export function watchBackgroundMemory(): void {
  if (typeof document === 'undefined') return;

  // Semnalul BUN, pe Android: sistemul insusi spune ca vrea memoria inapoi, iar
  // Play masoara fix atunci. Fara intarziere — aici nu mai e vorba de comutari
  // scurte, aplicatia chiar a iesit de pe ecran.
  window.addEventListener('luminTrimMemory', () => {
    resetBackgroundMemory();
    elibereaza();
  });

  // Rezerva, si singurul drum pe web: nu exista onTrimMemory in browser.
  document.addEventListener('visibilitychange', () => {
    onVisibilityChange(document.hidden, elibereaza);
  });
}
