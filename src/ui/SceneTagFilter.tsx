import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { SparkleIcon } from './icons';
import { t } from '../i18n';
import { translateSceneTag } from '../core/sceneTagLabels';
import { computeMenuPosition, isInsideAnyMenu, useReanchorOnViewportChange, type MenuPosition } from './dropdownPosition';

/**
 * Filtru dupa eticheta de scena/obiect (PhotoView.sceneTags, COCO-80 — ex.
 * "dog", "cake", "boat"), calculata deja de pipeline-ul de analiza dar pana
 * acum afisata doar in DetailView, fara niciun mod de a filtra grila dupa ea.
 * Aceeasi structura ca ColorLabelFilter (buton compact + meniu randat printr-un
 * portal in <body>, ca sa nu fie taiat de overflow-ul randului de filtre) —
 * doar ca lista de optiuni e dinamica (derivata din pozele curente), nu un
 * enum fix ca la etichetele de culoare.
 */
export function SceneTagFilter() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const photos = useStore(s => s.photos);
  const sceneTagFilter = useStore(s => s.sceneTagFilter);
  const setSceneTagFilter = useStore(s => s.setSceneTagFilter);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      for (const tag of p.sceneTags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [photos]);

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

  if (tags.length === 0) return null;

  return (
    <div className="scene-tag-filter">
      <button
        ref={triggerRef}
        type="button"
        className={sceneTagFilter ? 'chip scene-tag-filter-trigger active' : 'chip scene-tag-filter-trigger'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.sceneTagFilter.ariaLabel')}
      >
        <SparkleIcon className="chip-icon" aria-hidden="true" />
        {sceneTagFilter ? translateSceneTag(sceneTagFilter, locale) : tr('app.sceneTagFilter.label')}
      </button>
      {open && menuPos && createPortal(
        <div
          className="scene-tag-filter-menu"
          role="menu"
          aria-label={tr('app.sceneTagFilter.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, maxHeight: menuPos.maxHeight }}
        >
          {tags.map(([tagName, count]) => (
            <button
              key={tagName}
              type="button"
              role="menuitemradio"
              aria-checked={sceneTagFilter === tagName}
              className={sceneTagFilter === tagName ? 'scene-tag-filter-option active' : 'scene-tag-filter-option'}
              onClick={() => { setSceneTagFilter(sceneTagFilter === tagName ? null : tagName); setOpen(false); }}
            >
              <span>{translateSceneTag(tagName, locale)}</span>
              <b className="scene-tag-filter-count mono">{count}</b>
            </button>
          ))}
          {sceneTagFilter && (
            <button type="button" className="scene-tag-filter-option scene-tag-filter-clear" onClick={() => { setSceneTagFilter(null); setOpen(false); }}>
              {tr('app.sceneTagFilter.clear')}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
