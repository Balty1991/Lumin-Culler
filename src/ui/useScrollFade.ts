import { useCallback, useEffect, useState } from 'react';

/**
 * Pentru randuri cu scroll orizontal INTENTIONAT (.filters, .workspace-filmstrip) —
 * fara niciun indiciu vizual, continutul care depaseste latimea vizibila se taie
 * brusc la margine (arata ca un bug/UI netermiat, nu ca "mai sunt elemente,
 * deruleaza"). Urmareste pozitia de scroll si expune `fadeLeft`/`fadeRight`
 * (true = exista continut ascuns in acea directie), pe care consumatorul le
 * transforma in clase CSS ce aplica un mask-image de estompare pe margine
 * (vezi .filters.fade-left/.fade-right in styles.css) — se actualizeaza in timp
 * real la scroll, deci fade-ul dispare exact cand chiar nu mai e nimic de ascuns.
 *
 * Folosim un "callback ref ca state" (setNode), NU useRef + useEffect(..., []) —
 * elementul e adesea randat CONDITIONAT (ex. <nav> apare abia dupa primul import,
 * cand photos.length > 0). Cu useRef simplu, efectul de setup ar rula o singura
 * data, la montarea componentei PARINTE, cand ref.current e inca null (elementul
 * nu exista in DOM), si n-ar mai rula niciodata din nou cand elementul apare
 * ulterior. Cu nodul in state, efectul depinde de [node] si reporneste exact
 * cand React ataseaza ref-ul la elementul real.
 */
export function useScrollFade<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  useEffect(() => {
    if (!node) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = node;
      setFadeLeft(scrollLeft > 4);
      setFadeRight(scrollLeft + clientWidth < scrollWidth - 4);
    };

    update();
    node.addEventListener('scroll', update, { passive: true });
    // continutul (numarul de chip-uri) se poate schimba dinamic (ex. CameraFilter
    // apare doar cand exista 2+ aparate) — ResizeObserver prinde si asta, nu doar redimensionarea ferestrei
    const ro = new ResizeObserver(update);
    ro.observe(node);

    return () => { node.removeEventListener('scroll', update); ro.disconnect(); };
  }, [node]);

  return { ref, fadeLeft, fadeRight };
}
