import { useStore } from '../state/store';
import { HomeIcon, GridIcon, FocusIcon, MenuIcon } from './icons';
import { t } from '../i18n';

/**
 * Bara de navigare jos — patru spatii, nu patru sertare.
 *
 * Inainte era Acasa / Albume / Persoane / Meniu, si avea trei probleme, toate
 * din acelasi motiv: destinatiile erau alese dupa cum e ORGANIZATA aplicatia,
 * nu dupa ce FACE omul cu ea.
 *
 *  - Munca principala — trecerea prin poze — n-avea niciun tab. Se ajungea la
 *    ea doar prin butonul "Continua" de pe ecranul de start, adica singurul
 *    lucru pentru care exista aplicatia era la doua taps si depindea de un card.
 *  - Biblioteca, la fel: ascunsa sub "Vezi toate fotografiile".
 *  - Albume si Persoane sunt locuri unde intri rar si cu un scop anume. Un tab
 *    permanent pentru fiecare inseamna doua sferturi din bara ocupate de ce se
 *    foloseste cel mai putin.
 *
 * Acum: ACASA (ce urmeaza), BIBLIOTECA (toate pozele si filtrele), REVIZUIESTE
 * (decizi, cu numarul ramas pe tab) si MENIU. Albume si Persoane raman in
 * Meniu, unde erau si inainte — nu s-a pierdut nimic, doar au coborat de pe
 * bara pe care se sta.
 *
 * NU exista un tab "Studio", desi planul de produs il propune: editorul
 * lucreaza pe O POZA, si un tab care duce la un ecran gol cat timp n-ai ales
 * una ar fi un sfert de bara mort. Se deschide de pe poza, ca pana acum.
 *
 * Vizibila DOAR pe grila principala (nu in Workspace — ramura separata in
 * App.tsx care nu ajunge niciodata la acest component), cat timp exista poze.
 */
export function BottomNav() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const collectionsOpen = useStore(s => s.collectionsOpen);
  const setCollectionsOpen = useStore(s => s.setCollectionsOpen);
  const personsOpen = useStore(s => s.personsOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const menuOpen = useStore(s => s.menuOpen);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const tiktokSortOpen = useStore(s => s.tiktokSortOpen);
  const setTiktokSortOpen = useStore(s => s.setTiktokSortOpen);
  const setFilter = useStore(s => s.setFilter);

  if (photos.length === 0) return null;

  /** Cat mai e de decis — numarul care da sens tab-ului de revizuire. */
  const toReview = photos.filter(p => p.status === 'review' || p.status === 'pending').length;

  const closePanels = () => { setCollectionsOpen(false); setPersonsOpen(false); setMenuOpen(false); };
  const isHomeActive = !collectionsOpen && !personsOpen && !menuOpen && !homeGridOpen && !tiktokSortOpen;
  // `!tiktokSortOpen`: revizuirea se deschide PESTE grila, iar fara conditia
  // asta doua taburi apareau active in acelasi timp — si bara nu mai spunea
  // unde esti, ci unde ai fost.
  const isLibraryActive = homeGridOpen && !tiktokSortOpen && !collectionsOpen && !personsOpen && !menuOpen;

  // Un tap pe "Acasa" revine mereu la ecranul curat, la fel ca un tap pe tab-ul
  // activ in alte aplicatii mobile.
  const goHome = () => { closePanels(); setHomeGridOpen(false); };
  const goLibrary = () => { closePanels(); setHomeGridOpen(true); };
  // Revizuirea porneste pe coada de verificat, nu pe toata biblioteca: filtrul
  // se muta odata cu ea, ca ce ramane pe ecran dupa inchidere sa fie tot despre
  // ce tocmai lucrai.
  const goReview = () => { closePanels(); setFilter('review'); setTiktokSortOpen(true); };

  return (
    <nav className="bottom-nav glass" aria-label={tr('nav.ariaLabel')}>
      <button className={isHomeActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goHome} aria-current={isHomeActive}>
        <HomeIcon />
        <span>{tr('nav.home')}</span>
      </button>
      <button className={isLibraryActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goLibrary} aria-current={isLibraryActive}>
        <GridIcon />
        <span>{tr('nav.library')}</span>
      </button>
      <button
        className={tiktokSortOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'}
        onClick={goReview}
        aria-current={tiktokSortOpen}
        // Fara nimic de decis, tab-ul ar deschide un ecran gol. Ramane vizibil
        // (locul lui in bara nu se muta de la o sesiune la alta), dar inactiv.
        disabled={toReview === 0}
      >
        <FocusIcon />
        <span>{tr('nav.review')}</span>
        {toReview > 0 && <b className="bottom-nav-badge mono">{toReview > 99 ? '99+' : toReview}</b>}
      </button>
      <button className={menuOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={() => setMenuOpen(true)} aria-current={menuOpen}>
        <MenuIcon />
        <span>{tr('nav.me')}</span>
      </button>
    </nav>
  );
}
