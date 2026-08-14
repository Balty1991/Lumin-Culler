import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { BookmarkIcon, PlusIcon, TrashIcon } from './icons';
import { t } from '../i18n';
import { computeMenuPosition, isInsideAnyMenu, useReanchorOnViewportChange, type MenuPosition } from './dropdownPosition';

/**
 * Combinatii de filtre denumite de utilizator, reaplicabile dintr-un click
 * (cerinta directa: "filtre salvate, ex. doar poze cu zambet>60% si ochi
 * deschisi" — vezi state/savedFilters.ts pentru campurile chiar salvate).
 * Aceeasi structura de meniu-portal ca CollectionPicker: lista de presete +
 * un formular inline la final ca sa salvezi combinatia curenta sub un nume.
 */
export function SavedFiltersMenu() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const savedFilters = useStore(s => s.savedFilters);
  const saveCurrentFiltersAsPreset = useStore(s => s.saveCurrentFiltersAsPreset);
  const applySavedFilterPreset = useStore(s => s.applySavedFilterPreset);
  const deleteSavedFilterPreset = useStore(s => s.deleteSavedFilterPreset);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [newName, setNewName] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Un singur loc unde se decide pozitia — folosit si la deschidere, si la fiecare
      reancorare (rotire/derulare/redimensionare, vezi useReanchorOnViewportChange). */
  const place = (rect: DOMRect) => setMenuPos(computeMenuPosition(rect));
  useReanchorOnViewportChange(open, triggerRef, place);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) place(rect);
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if (isInsideAnyMenu(e.target)) return;
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

  const submitSave = (e: FormEvent) => {
    e.preventDefault();
    if (saveCurrentFiltersAsPreset(newName)) setNewName('');
  };

  return (
    <div className="saved-filters-menu">
      <button
        ref={triggerRef}
        type="button"
        className="chip"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.savedFilters.ariaLabel')}
      >
        <BookmarkIcon className="chip-icon" aria-hidden="true" />
        {tr('app.savedFilters.label')}
      </button>
      {open && menuPos && createPortal(
        <div
          className="scene-tag-filter-menu"
          role="menu"
          aria-label={tr('app.savedFilters.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, maxHeight: menuPos.maxHeight }}
        >
          {savedFilters.length === 0 && <p className="hint collection-picker-empty">{tr('app.savedFilters.empty')}</p>}
          {savedFilters.map(preset => (
            <div key={preset.id} className="saved-filters-row">
              <button
                type="button"
                role="menuitem"
                className="scene-tag-filter-option"
                onClick={() => { applySavedFilterPreset(preset.id); setOpen(false); }}
              >
                <span>{preset.name}</span>
              </button>
              <button
                type="button"
                className="ghost icon-btn small"
                onClick={() => deleteSavedFilterPreset(preset.id)}
                aria-label={tr('app.savedFilters.delete', { name: preset.name })}
                title={tr('app.savedFilters.delete', { name: preset.name })}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <form className="collection-picker-create" onSubmit={submitSave}>
            <input
              className="mono" placeholder={tr('app.savedFilters.newPlaceholder')}
              aria-label={tr('app.savedFilters.newPlaceholder')}
              value={newName} onChange={e => setNewName(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <button type="submit" className="ghost icon-btn" disabled={!newName.trim()} aria-label={tr('app.savedFilters.save')}>
              <PlusIcon />
            </button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
