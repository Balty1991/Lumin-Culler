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
 * Grid virtualizat pe RANDURI: doar cardurile vizibile (+ overscan) exista in DOM,
 * indiferent daca sunt 100 sau 10000 de poze — evita balonarea DOM-ului care ar
 * incetini scroll-ul/randarea pe biblioteci foarte mari. Foloseste PhotoCard-ul
 * existent (nu o varianta separata), deci pastreaza insigne/status/click identic
 * cu grid-ul normal — singura diferenta e MECANISMUL de randare, nu aspectul.
 */
export function VirtualPhotoGrid({ photos, onOpen, multiSelectIds, onCardPointerDown, onContextMenu }: {
  photos: PhotoView[];
  onOpen: (id: string, e: React.MouseEvent) => void;
  multiSelectIds: Set<string>;
  onCardPointerDown?: (id: string, e: React.PointerEvent) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const density = useStore(s => s.gridDensity);
  const [columns, setColumns] = useState(4);
  const [scrollHeight, setScrollHeight] = useState(600);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const compute = () => {
      const width = el.clientWidth;
      const minCard = width <= NARROW_BREAKPOINT ? CARD_MIN_WIDTH[density].narrow : CARD_MIN_WIDTH[density].wide;
      setColumns(Math.max(1, Math.floor((width + GAP) / (minCard + GAP))));
      const top = el.getBoundingClientRect().top;
      setScrollHeight(Math.max(300, window.innerHeight - top - 8));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [photos.length, density]);

  const rowCount = Math.ceil(photos.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 4
  });

  return (
    <div ref={parentRef} className="virtual-grid-scroll" style={{ height: scrollHeight }}>
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
