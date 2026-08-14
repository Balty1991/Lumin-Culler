import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PhotoCard } from './PhotoCard';
import { useStore, type PhotoView } from '../state/store';
import { CARD_MIN_WIDTH } from '../state/gridDensity';

/** Sub aceasta latime a containerului, folosim latimea minima "narrow" din CARD_MIN_WIDTH —
    coloanele trebuie calculate in JS pentru virtualizare pe randuri, nu doar CSS auto-fill. */
const NARROW_BREAKPOINT = 560;
const GAP = 10;
const ROW_HEIGHT_ESTIMATE = 200; // ajustat automat per rand prin measureElement (inaltimi variabile)
/**
 * Inaltimea barei de jos, CITITA din CSS in loc de copiata aici.
 *
 * Bug real gasit la auditul UI: valoarea era scrisa de mana (62) si nu includea
 * `env(safe-area-inset-bottom)`, desi `.bottom-nav` din CSS o include —
 * `height: calc(var(--bottomnav-h) + env(safe-area-inset-bottom))`. Pe
 * telefoanele cu bara de gesturi (home indicator), bara ocupa deci cu ~20-34px
 * mai mult decat credea grila, si ultimul rand de poze ajungea partial sub ea.
 *
 * Ambele valori sunt deja expuse ca variabile CSS tocmai pentru asta (vezi
 * --safe-bottom in styles.css, folosita la fel in ContextMenu.tsx), deci nu mai
 * exista o a doua sursa de adevar care sa poata iesi din sincron.
 */
function readBottomNavHeight(): number {
  if (typeof getComputedStyle !== 'function') return 62; // jsdom / medii fara layout
  const root = getComputedStyle(document.documentElement);
  const px = (name: string, fallback: number) => {
    const parsed = parseFloat(root.getPropertyValue(name));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return px('--bottomnav-h', 62) + px('--safe-bottom', 0);
}

/**
 * Grid virtualizat pe RANDURI: doar cardurile vizibile (+ overscan) exista in DOM,
 * indiferent daca sunt 100 sau 10000 de poze — evita balonarea DOM-ului care ar
 * incetini scroll-ul/randarea pe biblioteci foarte mari. Foloseste PhotoCard-ul
 * existent (nu o varianta separata), deci pastreaza insigne/status/click identic
 * cu grid-ul normal — singura diferenta e MECANISMUL de randare, nu aspectul.
 */
export function VirtualPhotoGrid({ photos, onOpen, multiSelectIds, onCardPointerDown, onContextMenu, onScroll }: {
  photos: PhotoView[];
  onOpen: (id: string, e: React.MouseEvent) => void;
  multiSelectIds: Set<string>;
  onCardPointerDown?: (id: string, e: React.PointerEvent) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  /** Raporteaza scrollTop-ul containerului intern — biblioteci mari (peste VIRTUALIZE_THRESHOLD)
      au propriul scroll, separat de fereastra, deci auto-hide-ul antetului (App.tsx) trebuie
      sa asculte aici, nu doar `window.scroll`. */
  onScroll?: (scrollTop: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const density = useStore(s => s.gridDensity);
  const [columns, setColumns] = useState(4);
  const [scrollHeight, setScrollHeight] = useState(600);
  const computeRef = useRef<() => void>(() => {});
  const recomputeScheduledRef = useRef(false);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const compute = () => {
      const width = el.clientWidth;
      const minCard = width <= NARROW_BREAKPOINT ? CARD_MIN_WIDTH[density].narrow : CARD_MIN_WIDTH[density].wide;
      setColumns(Math.max(1, Math.floor((width + GAP) / (minCard + GAP))));
      const top = el.getBoundingClientRect().top;
      // Recitita la fiecare calcul, nu o singura data: `compute` ruleaza si la
      // resize/rotire, iar marginea de siguranta de jos difera intre orientari.
      setScrollHeight(Math.max(300, window.innerHeight - top - 8 - readBottomNavHeight()));
    };
    computeRef.current = compute;
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [photos.length, density]);

  /**
   * Bug real gasit de auditul QA (raportat direct de utilizator, cu poze):
   * la scroll in jos, sub cardurile deja randate aparea o zona neagra
   * imensa, needita, chiar daca mai erau sute de poze mai jos in lista.
   * Cauza: `scrollHeight` (inaltimea acestui container) se calculeaza o
   * singura data la montare, din `top`-ul curent al elementului — dar
   * antetul (App.tsx) se ASCUNDE la scroll ("headerHidden", vezi
   * handleGridScroll), ceea ce muta `top`-ul containerului mai sus DUPA
   * ce am calculat deja o inaltime bazata pe `top`-ul VECHI (mai mare).
   * Containerul ramanea "inghetat" la inaltimea gresita (prea mica,
   * calculata cat timp antetul inca ocupa spatiu), desi acum era loc
   * pentru mai mult — restul spatiului de ecran ramanea complet gol/negru
   * dedesubt, in afara containerului scrollabil (fundalul paginii). Nu
   * exista niciun eveniment "antetul s-a ascuns" la care sa ne abonam din
   * acest component (independent de App.tsx) — dar orice ascundere de
   * antet e DECLANSATA tocmai de scroll-ul din acest container, deci
   * recalcularea la fiecare scroll (throttled per frame, nu per eveniment)
   * prinde exact acelasi moment, fara sa introduca un cuplaj nou intre
   * componente.
   */
  const scheduleRecompute = () => {
    if (recomputeScheduledRef.current) return;
    recomputeScheduledRef.current = true;
    requestAnimationFrame(() => {
      recomputeScheduledRef.current = false;
      computeRef.current();
    });
  };

  const rowCount = Math.ceil(photos.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 4
  });

  return (
    <div
      ref={parentRef} className="virtual-grid-scroll" style={{ height: scrollHeight }}
      onScroll={e => { onScroll?.(e.currentTarget.scrollTop); scheduleRecompute(); }}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {rowVirtualizer.getVirtualItems().map(vRow => (
          <div
            key={vRow.key}
            data-index={vRow.index}
            ref={rowVirtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
          >
            <div className="grid virtual-row" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
              {Array.from({ length: columns }, (_, col) => {
                const index = vRow.index * columns + col;
                const photo = photos[index];
                return photo
                  ? (
                    <PhotoCard
                      key={photo.id} photo={photo} index={index} onOpen={onOpen}
                      multiSelected={multiSelectIds.has(photo.id)}
                      onCardPointerDown={onCardPointerDown} onContextMenu={onContextMenu}
                    />
                  )
                  : null;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
