import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { FolderIcon, PlusIcon, CheckIcon } from './icons';
import { t } from '../i18n';
import { computeMenuPosition, isInsideAnyMenu, useReanchorOnViewportChange, type MenuPosition } from './dropdownPosition';

interface CollectionPickerProps {
  /** Fotografiile carora li se schimba apartenenta la un tap pe un folder — 1 (DetailView) sau selectia multipla (bulk-bar). */
  photoIds: string[];
  /** bulk-bar foloseste doar iconita (ca restul butoanelor de acolo); DetailView are loc pentru eticheta. */
  iconOnly?: boolean;
  /** Suprascrie clasa butonului-declansator — implicit 'ghost icon-btn'/'ghost small-btn' dupa iconOnly (ex. DetailView foloseste 'detail-overlay-btn', ca restul butoanelor plutitoare de acolo). */
  triggerClassName?: string;
}

/**
 * Popover "Adauga in folder" (cerinta directa a utilizatorului: foldere
 * personalizate, denumite de el, cu poze puse manual) — aceeasi structura de
 * meniu-portal ca SceneTagFilter (evita sa fie taiat de overflow-ul barelor
 * de unelte), dar cu bife (checkbox), nu radio: o poza poate fi in mai multe
 * foldere simultan (vezi core/db.ts, CollectionRecord).
 *
 * Bifat = TOATE `photoIds` sunt deja in acel folder; la selectie multipla cu
 * apartenenta mixta, apare nebifat (conservator) — un tap adauga toata
 * selectia; un tap pe unul deja bifat scoate toata selectia din el.
 */
export function CollectionPicker({ photoIds, iconOnly, triggerClassName }: CollectionPickerProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  // Dosarul privat (isPrivate) NU apare in acest selector — vezi CollectionsPanel.tsx.
  const collections = useStore(s => s.collections).filter(c => !c.isPrivate);
  const createCollection = useStore(s => s.createCollection);
  const addPhotosToCollection = useStore(s => s.addPhotosToCollection);
  const removePhotosFromCollection = useStore(s => s.removePhotosFromCollection);
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

  if (!photoIds.length) return null;

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const record = await createCollection(trimmed);
    setNewName('');
    if (record) void addPhotosToCollection(record.id, photoIds);
  };

  return (
    <div className="collection-picker">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? (iconOnly ? 'ghost icon-btn' : 'ghost small-btn')}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('collections.addToFolder')}
        title={tr('collections.addToFolder')}
      >
        <FolderIcon className={iconOnly ? undefined : 'inline-icon'} />
        {!iconOnly && <span>{tr('collections.addToFolder')}</span>}
      </button>
      {open && menuPos && createPortal(
        <div
          className="scene-tag-filter-menu collection-picker-menu"
          role="menu"
          aria-label={tr('collections.addToFolder')}
          ref={menuRef}
          style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, maxHeight: menuPos.maxHeight }}
        >
          {collections.length === 0 && <p className="hint collection-picker-empty">{tr('collections.empty')}</p>}
          {collections.map(c => {
            const checked = photoIds.every(id => c.memberIds.includes(id));
            return (
              <button
                key={c.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                className={checked ? 'scene-tag-filter-option active' : 'scene-tag-filter-option'}
                onClick={() => {
                  if (checked) void removePhotosFromCollection(c.id, photoIds);
                  else void addPhotosToCollection(c.id, photoIds);
                }}
              >
                <span>{c.name}</span>
                {checked && <CheckIcon className="inline-icon" aria-hidden="true" />}
              </button>
            );
          })}
          <form className="collection-picker-create" onSubmit={submitCreate}>
            <input
              className="mono" placeholder={tr('collections.newPlaceholder')}
              aria-label={tr('collections.newPlaceholder')}
              value={newName} onChange={e => setNewName(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <button type="submit" className="ghost icon-btn" disabled={!newName.trim()} aria-label={tr('collections.create')}>
              <PlusIcon />
            </button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
