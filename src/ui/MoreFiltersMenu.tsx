import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { MoreIcon, XIcon } from './icons';
import { t } from '../i18n';
import { computeMenuPosition, isInsideAnyMenu, type MenuPosition } from './dropdownPosition';

interface Props {
  /** true daca vreun filtru "secundar" (din interiorul panoului) e activ acum — evidentiaza trigger-ul. */
  active: boolean;
  /** numarul de fatete active din panou (0 = fara badge) — la fel ca chip-count de pe celelalte chip-uri. */
  badgeCount: number;
  /** primeste `close` ca sa poata inchide panoul dupa o alegere "finala" (ex. un filtru de status);
      celelalte controale din panou (persoana/eticheta/scena/aparat) isi gestioneaza singure propriul dropdown si raman deschise. */
  children: (close: () => void) => ReactNode;
}

/**
 * Grupeaza filtrele mai putin folosite (statusuri speciale + persoana/eticheta/
 * scena/aparat + modul de selectie) sub UN singur buton, ca randul principal de
 * filtre sa nu mai necesite scroll orizontal pe telefon (feedback direct:
 * "grupeaza cumva meniul asta, sa nu mai scrolez la dreapta"). Aceeasi structura
 * de portal ca ColorLabelFilter/SceneTagFilter/CameraFilter, dar panoul insusi
 * foloseste flex-wrap (nu scroll) pentru continutul mai bogat din interior.
 */
export function MoreFiltersMenu({ active, badgeCount, children }: Props) {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      // panoul are multe randuri (statusuri + persoana/eticheta/scena/aparat +
      // modul de selectie) — pe telefon, fara maxHeight+scroll intern, iesea
      // pur si simplu din josul ecranului, fara nicio cale sa vezi restul
      // (bug real raportat de utilizator). Acelasi calcul ca la dropdown-urile
      // nested din interior (vezi dropdownPosition.ts).
      if (rect) setMenuPos({ ...computeMenuPosition(rect, 10, 200), left: Math.min(rect.left, window.innerWidth - 336) });
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={active ? 'chip chip-compact more-filters-trigger active' : 'chip chip-compact more-filters-trigger'}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tr('app.moreFilters.ariaLabel')}
        title={tr('app.moreFilters.ariaLabel')}
      >
        <MoreIcon className="chip-icon" aria-hidden="true" />
        {badgeCount > 0 && <b className="chip-count">{badgeCount}</b>}
      </button>
      {open && menuPos && createPortal(
        <div
          className="more-filters-menu"
          role="menu"
          aria-label={tr('app.moreFilters.ariaLabel')}
          ref={menuRef}
          style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: menuPos.right, maxHeight: menuPos.maxHeight }}
        >
          <div className="more-filters-menu-head">
            <span>{tr('app.moreFilters.title')}</span>
            <button type="button" className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
              <XIcon />
            </button>
          </div>
          {/* corpul scroleaza intern, capul (cu butonul de inchidere) ramane
              mereu vizibil — vezi comentariul de la toggle() de mai sus */}
          <div className="more-filters-menu-body">
            {children(() => setOpen(false))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
