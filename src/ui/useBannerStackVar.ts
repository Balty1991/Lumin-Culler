import { useCallback, useRef } from 'react';

/**
 * ui/useBannerStackVar.ts
 * Publica inaltimea stivei de bannere plutitoare ca variabila CSS, ca sa se
 * poata REZERVA loc pentru ea in fluxul paginii.
 *
 * Bug real raportat de utilizator (captura de pe Acasa): bannerul "Urmatoarea
 * perioada de sortat" acoperea salutul de sub el, iar toastul de import se
 * suprapunea peste banner. `.banner-stack` e `position: fixed` (trebuie sa
 * pluteasca si peste Workspace, care n-are flux normal la care sa se ataseze),
 * deci nu ocupa niciun loc — si nimeni nu-i lasa unul.
 *
 * De ce masurare si nu o valoare scrisa de mana: in stiva pot fi intre zero si
 * cinci bannere deodata (amintiri, instalare, backup, reamintire de import,
 * supervizorul galeriei), fiecare cu textul lui, care pe telefoane inguste cade
 * pe mai multe randuri. Orice constanta ar fi gresita in aproape toate cazurile.
 *
 * Zero cand stiva nu e montata sau e goala — atunci nu e nimic de ocolit.
 */
const VAR = '--banner-stack-h';
/** Spatiul dintre ultimul banner si continutul de sub el. */
const GAP_PX = 8;

export function useBannerStackVar<T extends HTMLElement>() {
  const observerRef = useRef<ResizeObserver | null>(null);

  // Ref de tip callback, ca in useHeaderBottomVar: stiva se monteaza si se
  // demonteaza singura (dispare cat timp e deschis ecranul de bun venit), iar
  // un callback ref e chemat exact atunci, fara lista de dependinte.
  return useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty(VAR, '0px');
      return;
    }
    const apply = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      // Stiva goala (toate bannerele intoarc null) nu e o stiva — 0, nu 8.
      root.style.setProperty(VAR, height > 0 ? `${height + GAP_PX}px` : '0px');
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    observerRef.current = observer;
  }, []);
}
