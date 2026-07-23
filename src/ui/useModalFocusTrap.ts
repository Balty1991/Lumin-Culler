import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => el.offsetParent !== null); // doar cele vizibile in layout
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
