import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { MoreIcon, XIcon } from './icons';
import { t } from '../i18n';

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
 * Filtrele mai putin folosite, grupate sub un singur buton.
 *
 * A DOUA forma. Prima era un dropdown ancorat de buton, cu pastile asezate cu
 * flex-wrap inauntru — utilizatorul l-a respins de doua ori ("nu imi plac cum
 * se vad, cum sunt grupate", apoi "ai lasat la fel, nu ai schimbat meniul").
 * Acum e o foaie care urca de jos, cu randuri de lista pe toata latimea: nume,
 * numar, si o bifa pe filtrul pornit. Acelasi tipar ca in aplicatiile de
 * fotografie, si de trei ori mai usor de atins cu degetul decat pastilele.
 *
 * Ancorarea (computeMenuPosition, reancorare la derulare, plafoane de inaltime
 * calculate in JS) a disparut cu totul odata cu dropdown-ul: o foaie lipita de
 * marginea de jos n-are ce sa nimereasca gresit.
 */
export function MoreFiltersMenu({ active, badgeCount, children }: Props) {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={active ? 'chip filters-more-btn active' : 'chip filters-more-btn'}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={tr('app.moreFilters.ariaLabel')}
      >
        <MoreIcon className="chip-icon" aria-hidden="true" />
        <span className="filters-more-label">{tr('app.moreFilters.short')}</span>
        {badgeCount > 0 && <b className="chip-count">{badgeCount}</b>}
      </button>
      {open && createPortal(
        <div className="filter-sheet-scrim" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div
            className="filter-sheet"
            /* `role="group"`, nu `role="menu"` — continutul e eterogen (randuri de
               filtru, dropdown-uri de persoana/eticheta/scena/aparat, o actiune
               distructiva), adica un GRUP de controale, nu o lista de comenzi cu
               navigare pe sageti. `data-menu-surface` pastreaza comportamentul de
               "click inauntru" pentru dropdown-urile deschise din interior. */
            role="group"
            data-menu-surface=""
            aria-label={tr('app.moreFilters.ariaLabel')}
            ref={sheetRef}
          >
            <span className="filter-sheet-handle" aria-hidden="true" />
            <div className="filter-sheet-head">
              <span>{tr('app.moreFilters.title')}</span>
              <button type="button" className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
                <XIcon />
              </button>
            </div>
            <div className="filter-sheet-body">
              {children(() => setOpen(false))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
