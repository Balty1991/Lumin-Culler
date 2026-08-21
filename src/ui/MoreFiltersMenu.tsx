import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { MoreIcon, XIcon } from './icons';
import { t } from '../i18n';
import { computeMenuPosition, isInsideAnyMenu, useReanchorOnViewportChange, type MenuPosition } from './dropdownPosition';

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

  /** Un singur loc unde se decide pozitia — folosit si la deschidere, si la fiecare
      reancorare (rotire/derulare/redimensionare, vezi useReanchorOnViewportChange). */
  /**
   * Bara de navigare de jos e fixa si acopera ultimii ~76px de ecran. Plafonul
   * intors de computeMenuPosition are un MINIM garantat (minHeight), care poate
   * fi mai mare decat spatiul chiar disponibil — masurat in browser, panoul
   * ajungea cu marginea de jos sub marginea ecranului. Aici il taiem la loc.
   */
  const BOTTOM_NAV_PX = 76;
  const place = (rect: DOMRect) => {
    const pos = computeMenuPosition(rect, 10, 200);
    const available = pos.top !== undefined
      ? window.innerHeight - pos.top - BOTTOM_NAV_PX
      : window.innerHeight - BOTTOM_NAV_PX - 10;
    setMenuPos({
      ...pos,
      // Butonul poate fi partial sub bara de jos (randul de filtre se ascunde la
      // derulare): atunci ancora calculata iese din ecran — masurat, bottom
      // ajungea la -2px, adica panoul incepea sub marginea de jos. Ancorele se
      // tin in ecran indiferent unde a ajuns butonul.
      top: pos.top !== undefined ? Math.min(pos.top, window.innerHeight - 160) : undefined,
      bottom: pos.bottom !== undefined ? Math.max(BOTTOM_NAV_PX, pos.bottom) : undefined,
      maxHeight: Math.max(160, Math.min(pos.maxHeight, available)),
      left: Math.max(10, Math.min(rect.left, window.innerWidth - 336))
    });
  };
  useReanchorOnViewportChange(open, triggerRef, place);

  const toggle = () => {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect();
      // panoul are multe randuri (statusuri + persoana/eticheta/scena/aparat +
      // modul de selectie) — pe telefon, fara maxHeight+scroll intern, iesea
      // pur si simplu din josul ecranului, fara nicio cale sa vezi restul
      // (bug real raportat de utilizator). Acelasi calcul ca la dropdown-urile
      // nested din interior (vezi dropdownPosition.ts).
      // Bug real gasit de auditul QA: pe un viewport mai ingust de 336px,
      // `window.innerWidth - 336` devine negativ si castiga mereu Math.min,
      // impingand panoul in afara ecranului spre stanga INDIFERENT de unde
      // se afla efectiv butonul — un Math.max(margin, ...) opreste clamp-ul
      // sa treaca sub marginea vizibila a ecranului.
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={active ? 'chip chip-compact more-filters-trigger active' : 'chip chip-compact more-filters-trigger'}
        onClick={toggle}
        aria-expanded={open}
        // fara aria-haspopup: singurele valori posibile ar minti la fel ca vechiul
        // role="menu" (nu e nici meniu, nici dialog). `aria-expanded` de mai sus
        // spune deja tot ce trebuie — ca butonul deschide si inchide ceva.
        aria-label={tr('app.moreFilters.ariaLabel')}
        title={tr('app.moreFilters.ariaLabel')}
      >
        <MoreIcon className="chip-icon" aria-hidden="true" />
        {badgeCount > 0 && <b className="chip-count">{badgeCount}</b>}
      </button>
      {open && menuPos && createPortal(
        <div
          className="more-filters-menu"
          /*
           * `role="group"`, nu `role="menu"` — bug real de accesibilitate gasit de
           * auditul UI: `menu` promite un tipar pe care panoul nu-l implementa
           * deloc (niciun `role="menuitem"` in copii, nicio navigare cu sagetile),
           * iar un cititor de ecran anunta "meniu" si trece in modul de navigare
           * specific lui, unde sagetile ar trebui sa mute intre comenzi si nu fac
           * nimic. Continutul e oricum eterogen — pastile de status, dropdown-uri
           * de persoana/eticheta/scena/aparat, un comutator de mod — adica exact
           * un GRUP de controale, nu o lista de comenzi. `data-menu-surface`
           * pastreaza comportamentul de "click inauntru" pentru dropdown-urile
           * deschise din interior (vezi isInsideAnyMenu).
           */
          role="group"
          data-menu-surface=""
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
