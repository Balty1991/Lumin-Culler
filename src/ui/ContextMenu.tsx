import { useEffect, useRef } from 'react';
import { CheckIcon, ClockIcon, XIcon, SearchIcon } from './icons';
import { StarRating } from './StarRating';
import { CollectionPicker } from './CollectionPicker';
import { isInsideAnyMenu } from './dropdownPosition';
import { COLOR_LABELS, type PhotoRecord, type ColorLabel } from '../core/db';
import { useStore } from '../state/store';
import { t } from '../i18n';

interface ContextMenuProps {
  x: number;
  y: number;
  /** Pozele pe care le vizeaza actiunile — vezi `count`. Trimise lui CollectionPicker ("Adauga in folder"). */
  photoIds: string[];
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
 *
 * "Adauga in folder" e aici la cererea directa a utilizatorului: exista deja in
 * bara de selectie in masa si in DetailView, dar ambele cer sa STII intai de
 * modul de selectie multipla (un chip cu bifa, la capatul randului de filtre)
 * — feedback pe device: "e cam greu de gasit, daca nu spuneai nu stiam; era mai
 * simplu sa tii apasat pe o poza si sa se declanseze". Apasarea lunga deschidea
 * deja acest meniu, deci gestul lui natural doar nu gasea aici actiunea asteptata.
 */
export function ContextMenu({ x, y, photoIds, count, rating, colorLabel, onSetStatus, onSetRating, onSetColorLabel, onOpenDetail, onClose }: ContextMenuProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      // isInsideAnyMenu: popover-ul lui CollectionPicker de mai jos e randat printr-un
      // PORTAL in <body>, deci in DOM nu e descendentul lui `ref` desi vizual iese din
      // acest meniu — fara aceasta verificare, primul tap pe un folder ar inchide meniul
      // contextual (si odata cu el popover-ul), inainte ca alegerea sa se aplice. Exact
      // bug-ul deja documentat pentru MoreFiltersMenu, vezi ui/dropdownPosition.ts.
      if (ref.current && !ref.current.contains(e.target as Node) && !isInsideAnyMenu(e.target)) onClose();
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

  // clamp si la 8px minim, nu doar la marginea dreapta/jos — pe viewport-uri foarte
  // inguste (foldables in cover mode, split-screen) meniul putea iesi partial in stanga/sus
  // (bug real gasit de auditul QA).
  const style = {
    left: Math.max(8, Math.min(x, window.innerWidth - 210)),
    // 270, nu 230: randul "Adauga in folder" (plus separatorul lui) a crescut inaltimea
    // meniului — cu vechea valoare, o apasare lunga langa marginea de jos il lasa taiat.
    top: Math.max(8, Math.min(y, window.innerHeight - 270))
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
      <div className="context-menu-sep" />
      {/* NU trece prin act(): CollectionPicker isi deschide propriul popover, iar
          inchiderea meniului la primul tap ar face alegerea folderului imposibila. */}
      <CollectionPicker photoIds={photoIds} triggerClassName="context-menu-item context-menu-folder" />
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
