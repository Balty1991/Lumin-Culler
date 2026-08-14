import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Doar elementele pe care browserul chiar le opreste la Tab.
 *
 * Inlocuieste vechiul test `el.offsetParent !== null`, care avea DOUA gauri
 * reale, ambele cu acelasi efect: un element ramanea gresit in lista (sau
 * gresit in afara ei), deci `first`/`last` nu erau capetele adevarate ale
 * ciclului, iar la capat Tab-ul iesea din panou in pagina de dedesubt —
 * exact ce trebuia sa impiedice capcana.
 *
 * 1. `offsetParent` e null si pentru un element `position: fixed`, nu doar
 *    pentru unul ascuns. In aplicatie exista cel putin unul chiar asa:
 *    `.welcome-onboarding-skip` (X-ul din ecranul de bun venit) — primul buton
 *    din panou, exclus din lista, deci Shift+Tab de pe el nu mai era prins de
 *    nimeni si ducea focusul afara.
 * 2. `offsetParent` NU e null pentru `visibility: hidden`, desi browserul
 *    sare peste asa ceva la Tab — un buton ascuns astfel putea ajunge `last`,
 *    iar wrap-ul de la sfarsit nu se mai declansa niciodata.
 *
 * `getClientRects()` gol acopera corect display:none/detasat/fara casete
 * (inclusiv pentru elemente fixed, care AU casete), iar `visibility` se
 * verifica separat, calculat (prinde si mostenirea de la un parinte).
 */
function isTabbable(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/**
 * Focus trap + restore pentru panourile modale (.detail/.detail-inner —
 * DetailView, GroupCompare, Persoane, Preferinte AI, Operatii in masa,
 * Scurtaturi). Fara asta, un utilizator de tastatura putea sa iasa din
 * panou cu Tab direct in pagina din spate (ramasa vizibila/interactiva sub
 * backdrop-ul semi-transparent), iar la inchidere focusul se pierdea in
 * <body> in loc sa revina pe butonul care a deschis panoul.
 *
 * `active` trebuie sa reflecte starea "deschis" a panoului. Componentele
 * care fac `if (!open) return null` mai jos in acelasi corp de functie sunt
 * sigure — hook-ul insusi tot trebuie apelat neconditionat (regula hook-urilor),
 * dar efectul lui verifica `active` intern inainte sa actioneze.
 */
export function useModalFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const firstFocusable = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? container)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !container) return;
      const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const visible = all.filter(isTabbable);
      // Rezerva pentru mediile fara layout real (jsdom in teste: `getClientRects()`
      // intoarce mereu gol, deci filtrul ar goli lista si capcana n-ar mai face
      // nimic). Intr-un browser adevarat `visible` e gol doar cand chiar nu exista
      // nimic focusabil vizibil, caz in care si lista bruta e la fel de buna.
      const focusables = visible.length ? visible : all;
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef]);
}
