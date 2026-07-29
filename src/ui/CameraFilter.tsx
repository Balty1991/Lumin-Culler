import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { ApertureIcon } from './icons';
import { t } from '../i18n';

/**
 * Filtru dupa aparatul foto (PhotoView.cameraModel, citit din EXIF) — util la
 * sedinte filmate cu 2+ aparate (ex. fotograf principal + secund la o nunta,
 * sau comparat rezultatele intre doua corpuri/obiective). Aceeasi structura ca
 * SceneTagFilter (buton compact + meniu randat printr-un portal in <body>).
 * Se afiseaza DOAR daca exista cel putin 2 aparate distincte in biblioteca
 * curenta — cu un singur aparat, filtrul n-ar avea niciun rost (ar selecta
 * fie tot, fie nimic), asa ca ramane ascuns ca sa nu aglomereze bara de filtre
 * in cazul comun (o sedinta, un aparat).
 */
export function CameraFilter() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const photos = useStore(s => s.photos);
  const cameraFilter = useStore(s => s.cameraFilter);
  const setCameraFilter = useStore(s => s.setCameraFilter);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const cameras = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of photos) {
      if (p.cameraModel) counts.set(p.cameraModel, (counts.get(p.cameraModel) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [photos]);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left });
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

  if (cameras.length < 2) return null;

  return (
    <div className="scene-tag-filter">
      <button
        ref={triggerRef}
        type="button"
        className={cameraFilter ? 'chip scene-tag-filter-trigger active' : 'chip scene-tag-filter-trigger'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.cameraFilter.ariaLabel')}
      >
        <ApertureIcon className="chip-icon" aria-hidden="true" />
        {cameraFilter ?? tr('app.cameraFilter.label')}
      </button>
      {open && menuPos && createPortal(
        <div
          className="scene-tag-filter-menu"
          role="menu"
          aria-label={tr('app.cameraFilter.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {cameras.map(([cameraName, count]) => (
            <button
              key={cameraName}
              type="button"
              role="menuitemradio"
              aria-checked={cameraFilter === cameraName}
              className={cameraFilter === cameraName ? 'scene-tag-filter-option active' : 'scene-tag-filter-option'}
              onClick={() => { setCameraFilter(cameraFilter === cameraName ? null : cameraName); setOpen(false); }}
            >
              <span>{cameraName}</span>
              <b className="scene-tag-filter-count mono">{count}</b>
            </button>
          ))}
          {cameraFilter && (
            <button type="button" className="scene-tag-filter-option scene-tag-filter-clear" onClick={() => { setCameraFilter(null); setOpen(false); }}>
              {tr('app.sceneTagFilter.clear')}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
