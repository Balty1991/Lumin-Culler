import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { FilterDotIcon } from './icons';
import { SORT_KEY_LABELS, type SortKey } from '../state/gridSort';
import { dateInputToEpoch, epochToDateInput } from '../state/dateInput';
import { t } from '../i18n';

/**
 * Filtrele avansate (rating minim, sortare, interval de date) — grupate sub un
 * singur buton + popover, in loc sa stea intinse pe un al doilea rand intreg
 * mereu vizibil deasupra grilei. Pe mobil, randul acela plus statisticile plus
 * primul rand de chip-uri de status impingeau prima poza mult sub fold si
 * faceau chip-urile de status sa se taie la marginea ecranului (feedback
 * direct de la utilizator). Cautarea dupa nume ramane vizibila direct langa
 * acest buton — e cea mai folosita dintre filtre.
 */
export function AdvancedFiltersPanel() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const filter = useStore(s => s.filter);
  const searchText = useStore(s => s.searchText);
  const minRating = useStore(s => s.minRating);
  const setMinRating = useStore(s => s.setMinRating);
  const gridSort = useStore(s => s.gridSort);
  const setGridSort = useStore(s => s.setGridSort);
  const dateFrom = useStore(s => s.dateFrom);
  const dateTo = useStore(s => s.dateTo);
  const setDateRange = useStore(s => s.setDateRange);
  const clearAdvancedFilters = useStore(s => s.clearAdvancedFilters);

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeCount = (minRating > 0 ? 1 : 0) + (dateFrom !== null || dateTo !== null ? 1 : 0);
  const anyActive = !!searchText || activeCount > 0;

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        // ancorat de regula la marginea stanga a butonului (ca celelalte filtre-popover,
        // vezi ColorLabelFilter) — dar clampat sa nu depaseasca marginea DREAPTA a
        // ecranului pe telefoane inguste, unde panoul (~280px) nu mai incape intins
        // de la butonul "Filtre" (care sta aproape de marginea stanga a randului).
        const menuWidth = Math.min(280, window.innerWidth - 24);
        const left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
        setMenuPos({ top: rect.bottom + 6, left: Math.max(12, left) });
      }
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="advanced-filters">
      <button
        ref={triggerRef}
        type="button"
        className={activeCount > 0 ? 'chip advanced-filters-trigger active' : 'chip advanced-filters-trigger'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={tr('app.filtersAdvanced.ariaLabel')}
      >
        <FilterDotIcon className="chip-icon" aria-hidden="true" />
        {tr('app.advancedFilters.toggle')}
        {activeCount > 0 && <b className="advanced-filters-badge mono">{activeCount}</b>}
      </button>
      {open && menuPos && createPortal(
        <div
          className="advanced-filters-menu"
          role="dialog"
          aria-label={tr('app.filtersAdvanced.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <label className="advanced-filters-row">
            <span>{tr('app.ratingFilter.ariaLabel')}</span>
            <select
              className={minRating > 0 ? 'chip rating-filter active' : 'chip rating-filter'}
              value={minRating}
              onChange={e => setMinRating(Number(e.target.value))}
              aria-label={tr('app.ratingFilter.ariaLabel')}
            >
              <option value={0}>{tr('app.ratingFilter.any')}</option>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{'★'.repeat(n)}+ </option>)}
            </select>
          </label>
          <label className="advanced-filters-row" title={filter === 'series' ? tr('app.sort.seriesOverride') : undefined}>
            <span>{tr('app.sort.ariaLabel')}</span>
            <span className="sort-control">
              <select
                className="chip sort-key"
                value={gridSort.key}
                disabled={filter === 'series'}
                onChange={e => setGridSort({ key: e.target.value as SortKey, dir: gridSort.dir })}
                aria-label={tr('app.sort.ariaLabel')}
              >
                {(Object.keys(SORT_KEY_LABELS) as SortKey[]).map(key => (
                  <option key={key} value={key}>{tr(`app.sort.key.${key}`)}</option>
                ))}
              </select>
              <button
                type="button"
                className="chip sort-dir"
                disabled={filter === 'series'}
                onClick={() => setGridSort({ key: gridSort.key, dir: gridSort.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={gridSort.dir === 'asc' ? tr('app.sort.ascToDesc') : tr('app.sort.descToAsc')}
                title={gridSort.dir === 'asc' ? tr('app.sort.asc') : tr('app.sort.desc')}
              >
                {gridSort.dir === 'asc' ? '↑' : '↓'}
              </button>
            </span>
          </label>
          <label className="advanced-filters-row date-field">
            {tr('app.dateFrom')}
            <input
              type="date"
              value={epochToDateInput(dateFrom)}
              onChange={e => setDateRange(dateInputToEpoch(e.target.value, false), dateTo)}
              aria-label={tr('app.dateFrom.ariaLabel')}
            />
          </label>
          <label className="advanced-filters-row date-field">
            {tr('app.dateTo')}
            <input
              type="date"
              value={epochToDateInput(dateTo)}
              onChange={e => setDateRange(dateFrom, dateInputToEpoch(e.target.value, true))}
              aria-label={tr('app.dateTo.ariaLabel')}
            />
          </label>
          {anyActive && (
            <button type="button" className="ghost small advanced-filters-reset" onClick={() => { clearAdvancedFilters(); setOpen(false); }}>
              {tr('app.resetFilters')}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
