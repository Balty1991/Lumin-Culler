import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { MoreIcon, LayersIcon, StarIcon, EyeClosedIcon, SunIcon, CheckIcon } from './icons';
import { ColorLabelFilter } from './ColorLabelFilter';
import { SceneTagFilter } from './SceneTagFilter';
import { CameraFilter } from './CameraFilter';
import { selectHighlights, selectBlinks } from '../state/batchOps';
import { t } from '../i18n';
import type { FilterKey } from '../state/store';

/**
 * Filtrele secundare (mai rar folosite decat Toate/Selectate/De verificat/
 * Respinse — cele 4 ramase mereu vizibile ca segmente cu latime fixa in
 * randul principal) — grupate aici in loc sa se intinda pe un rand
 * orizontal-scrollabil: pe mobil, randul de 8+ chip-uri + selecte se taia
 * la marginea ecranului, fara niciun semnal clar ca mai e ceva de derulat
 * (feedback direct: "nu mai vreau sa dau swipe aici").
 */
export function MoreFiltersPanel() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const photos = useStore(s => s.photos);
  const filter = useStore(s => s.filter);
  const setFilter = useStore(s => s.setFilter);
  const persons = useStore(s => s.persons);
  const personFilter = useStore(s => s.personFilter);
  const setPersonFilter = useStore(s => s.setPersonFilter);
  const colorLabelFilter = useStore(s => s.colorLabelFilter);
  const setColorLabelFilter = useStore(s => s.setColorLabelFilter);
  const selectMode = useStore(s => s.selectMode);
  const setSelectMode = useStore(s => s.setSelectMode);
  const multiSelectIds = useStore(s => s.multiSelectIds);

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const secondary: { key: FilterKey; label: string; count: number; icon: ReactNode }[] = [
    { key: 'series', label: tr('palette.filter.series'), count: photos.filter(p => p.groupId).length, icon: <LayersIcon /> },
    { key: 'highlights', label: tr('palette.filter.highlights'), count: selectHighlights(photos).length, icon: <StarIcon /> },
    { key: 'blinks', label: tr('palette.filter.blinks'), count: selectBlinks(photos).length, icon: <EyeClosedIcon /> },
    { key: 'goldenHour', label: tr('palette.filter.goldenHour'), count: photos.filter(p => p.goldenHourDetected).length, icon: <SunIcon /> }
  ];
  const secondaryActive = secondary.some(f => f.key === filter);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const menuWidth = Math.min(300, window.innerWidth - 24);
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
    <>
      <button
        ref={triggerRef}
        type="button"
        className={secondaryActive ? 'seg active more' : 'seg more'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.moreFilters.ariaLabel')}
      >
        <MoreIcon />
      </button>
      {open && menuPos && createPortal(
        <div className="more-filters-menu" role="menu" aria-label={tr('app.moreFilters.ariaLabel')} ref={menuRef} style={{ top: menuPos.top, left: menuPos.left }}>
          <div className="more-filters-row">
            {secondary.map(f => (
              <button
                key={f.key}
                className={filter === f.key ? 'chip active' : 'chip'}
                onClick={() => { setFilter(f.key); setOpen(false); }}
                aria-pressed={filter === f.key}
              >
                <span className="chip-icon" aria-hidden="true">{f.icon}</span>
                {f.label}
                <b className="chip-count">{f.count}</b>
              </button>
            ))}
          </div>
          <div className="more-filters-row">
            {persons.length > 0 && (
              <select
                className={personFilter ? 'chip person-filter active' : 'chip person-filter'}
                value={personFilter ?? ''}
                onChange={e => setPersonFilter(e.target.value || null)}
                aria-label={tr('app.personFilter.ariaLabel')}
              >
                <option value="">{tr('app.personFilter.any')}</option>
                {persons.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            )}
            <ColorLabelFilter value={colorLabelFilter} onChange={setColorLabelFilter} />
            <SceneTagFilter />
            <CameraFilter />
            {multiSelectIds.size === 0 && (
              <button
                className={selectMode ? 'chip active select-mode-toggle' : 'chip select-mode-toggle'}
                onClick={() => { setSelectMode(!selectMode); setOpen(false); }}
                aria-pressed={selectMode}
              >
                <CheckIcon className="inline-icon" aria-hidden="true" /> {selectMode ? tr('app.selectMode.active') : tr('app.selectMode.toggle')}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
