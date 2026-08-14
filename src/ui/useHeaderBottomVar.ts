import { useCallback, useRef } from 'react';

/**
 * ui/useHeaderBottomVar.ts
 * Publica marginea de JOS a capului de ecran ca variabila CSS, ca suprafetele
 * plutitoare (deocamdata toastul) sa se aseze sub el fara sa ghiceasca.
 *
 * Bug real raportat de utilizator (captura): toastul acoperea butonul "Exporta
 * poze". Cauza: `top: calc(60px + safe-area)`, o valoare scrisa de mana care
 * presupune un cap de ecran de UN rand. Pe telefon, `.topbar` are flex-wrap si
 * cade pe DOUA randuri (logo sus, butoanele dedesubt), deci depaseste dublul
 * acelei valori — iar 60px il aseza fix peste al doilea rand.
 *
 * De ce masurare si nu alt numar fix: inaltimea depinde de latimea ecranului
 * (cate randuri se aduna), de safe-area-inset-top (fiecare telefon are alta) si
 * de care ecran e activ (`.topbar` in grila, `.workspace-head` pe ecranul
 * principal, cu alt padding si alta margine). Orice constanta ar fi corecta
 * pentru exact un telefon si un ecran.
 *
 * Se foloseste `bottom`, nu `height`: include si marginea de sus a capului
 * (`.workspace-head` are 10px), deci e direct coordonata sub care e liber.
 */
const VAR = '--header-bottom';

/**
 * Rezerva pentru cazul in care niciun cap de ecran nu e montat (nu se intampla
 * azi, dar un toast pozitionat gresit e mai bun decat unul lipit de bara de
 * status). Generoasa deliberat: mai bine putin prea jos decat peste butoane.
 */
const FALLBACK = '96px';

export function useHeaderBottomVar<T extends HTMLElement>() {
  const observerRef = useRef<ResizeObserver | null>(null);

  // Ref de tip callback, nu useEffect: elementul se schimba cand utilizatorul
  // trece intre ecranul principal si grila (alt cap, alta inaltime), iar un
  // callback ref e chemat exact la montare/demontare — fara sa depinda de o
  // lista de dependinte care ar trebui tinuta la zi.
  return useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty(VAR, FALLBACK);
      return;
    }
    const apply = () => root.style.setProperty(VAR, `${Math.round(node.getBoundingClientRect().bottom)}px`);
    apply();
    // Se reia la fiecare schimbare de inaltime: rotirea telefonului, aparitia
    // campului de nume de proiect, sau textul care trece pe inca un rand.
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    observerRef.current = observer;
  }, []);
}
