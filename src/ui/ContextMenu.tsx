import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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

  // Pozitia finala se calculeaza din dimensiunea REALA a meniului, masurata dupa
  // randare — vezi useLayoutEffect. Pana atunci il tinem invizibil (o singura
  // cadra), ca sa nu se vada sarind de la pozitia bruta la cea corectata.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  /**
   * Bug real raportat pe device: "cand selectez o poza de jos, nu mai este vizibil
   * tab-ul". Pozitia se calcula scazand din viewport o CONSTANTA presupusa a fi
   * inaltimea meniului — o presupunere care s-a invechit de fiecare data cand
   * meniul a mai primit un rand (etichete de culoare, apoi "Adauga in folder"),
   * lasand o apasare lunga langa marginea de jos sa produca un meniu taiat.
   *
   * Masuram in schimb dimensiunea reala dupa randare si o incadram in viewport.
   * Asa, orice actiune adaugata mai tarziu ramane vizibila fara sa mai trebuiasca
   * sa-si aminteasca cineva sa actualizeze o cifra de aici.
   *
   * Scadem si marginile sigure: pe Android edge-to-edge (targetSdk 35+) WebView-ul
   * se intinde SUB bara de navigare, deci window.innerHeight singur nu spune unde
   * se termina zona chiar vizibila — exact ce se vedea in captura, cu ultimele
   * randuri ale meniului ascunse in spatele barei.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const MARGIN = 8;
    const { width, height } = el.getBoundingClientRect();
    const root = getComputedStyle(document.documentElement);
    const inset = (name: string) => parseFloat(root.getPropertyValue(name)) || 0;
    const safeTop = inset('--safe-top');
    const safeBottom = inset('--safe-bottom');

    const maxLeft = window.innerWidth - width - MARGIN;
    const maxTop = window.innerHeight - height - MARGIN - safeBottom;
    setPos({
      left: Math.max(MARGIN, Math.min(x, maxLeft)),
      top: Math.max(MARGIN + safeTop, Math.min(y, maxTop))
    });
  }, [x, y]);

  const style: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' };

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
