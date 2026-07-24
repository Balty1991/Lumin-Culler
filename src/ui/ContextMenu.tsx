import { useEffect, useRef } from 'react';
import { CheckIcon, ClockIcon, XIcon, SearchIcon } from './icons';
import { StarRating } from './StarRating';
import { COLOR_LABELS, type PhotoRecord, type ColorLabel } from '../core/db';
import { useStore } from '../state/store';
import { t } from '../i18n';

interface ContextMenuProps {
  x: number;
  y: number;
  /** Cate poze afecteaza actiunile din meniu — 1 (poza pe care s-a facut click-dreapta/apasare lunga) sau toata selectia in masa, daca poza vizata face deja parte din ea. */
  count: number;
  /** Ratingul curent, pentru a preseta stelele — 0 cand actioneaza pe o selectie de mai multe poze (rating-urile pot diferi). */
  rating: number;
  /** Eticheta de culoare curenta — 'none' cand actioneaza pe o selectie de mai multe poze (etichetele pot diferi). */
  colorLabel: ColorLabel;
  onSetStatus: (status: PhotoRecord['status']) => void;
  onSetRating: (n: number) => void;
  onSetColorLabel: (label: ColorLabel) => void;
  /** Absent cand meniul actioneaza pe o selectie de mai multe poze — "deschide detalii" nu are sens pentru mai multe poze deodata. */
  onOpenDetail?: () => void;
  onClose: () => void;
}

/**
 * Meniu contextual pe grila (plan 3.2.1) — click-dreapta pe desktop, apasare lunga
 * pe touch (vezi onCardPointerDown din App.tsx). Actiuni rapide fara sa deschizi
 * DetailView: decizie (selecteaza/verifica/respinge) + rating, aplicate fie unei
 * singure poze, fie intregii selectii in masa curente (daca poza vizata face parte din ea).
 */
export function ContextMenu({ x, y, count, rating, colorLabel, onSetStatus, onSetRating, onSetColorLabel, onOpenDetail, onClose }: ContextMenuProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // "capture" + urmatorul tick: evita sa inchida meniul chiar la evenimentul care l-a deschis (right-click/long-press)
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const style = {
    left: Math.min(x, window.innerWidth - 210),
    top: Math.min(y, window.innerHeight - 230)
  };

  const act = (fn: () => void) => { fn(); onClose(); };

  return (
    <div className="context-menu glass" style={style} ref={ref} role="menu" aria-label={tr('contextMenu.ariaLabel')}>
      <div className="context-menu-title mono">{count > 1 ? tr('contextMenu.titleSelection', { count }) : tr('contextMenu.title')}</div>
      <button className="context-menu-item" role="menuitem" onClick={() => act(() => onSetStatus('selected'))}>
        <CheckIcon className="inline-icon" /> {tr('contextMenu.select')}
      </button>
      <button className="context-menu-item" role="menuitem" onClick={() => act(() => onSetStatus('review'))}>
        <ClockIcon className="inline-icon" /> {tr('contextMenu.review')}
      </button>
      <button className="context-menu-item" role="menuitem" onClick={() => act(() => onSetStatus('rejected'))}>
        <XIcon className="inline-icon" /> {tr('contextMenu.reject')}
      </button>
      <div className="context-menu-sep" />
      <div className="context-menu-rating">
        <span>{tr('contextMenu.rating')}</span>
        <StarRating rating={rating} onRate={n => act(() => onSetRating(n))} size="sm" />
      </div>
      <div className="context-menu-sep" />
      <div className="context-menu-color-labels">
        <span>{tr('contextMenu.colorLabel')}</span>
        <div className="color-label-swatches">
          {COLOR_LABELS.map(c => (
            <button
              key={c}
              type="button"
              className={colorLabel === c ? `color-label-swatch label-${c} active` : `color-label-swatch label-${c}`}
              onClick={() => act(() => onSetColorLabel(colorLabel === c ? 'none' : c))}
              aria-pressed={colorLabel === c}
              aria-label={tr(`colorLabel.${c}`)}
              title={tr(`colorLabel.${c}`)}
            />
          ))}
        </div>
      </div>
      {onOpenDetail && (
        <>
          <div className="context-menu-sep" />
          <button className="context-menu-item" role="menuitem" onClick={() => act(onOpenDetail)}>
            <SearchIcon className="inline-icon" /> {tr('contextMenu.openDetail')}
          </button>
        </>
      )}
    </div>
  );
}
