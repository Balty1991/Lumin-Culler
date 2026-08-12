import { useStore } from '../state/store';
import { HomeIcon, FolderIcon, UserCheckIcon, MenuIcon } from './icons';
import { t } from '../i18n';

/**
 * Bara de navigare jos (cerinta directa: aplicatia reala sa arate ca directia
 * din mockup-uri) — inlocuieste vizual meniul hamburger ca prim punct de acces
 * pentru Albume/Persoane/Eu, fara sa elimine meniul complet (Meniul ramane,
 * acum deschis si de tab-ul "Eu" — restul optiunilor tehnice raman acolo,
 * neatinse). "Albume" deschide Colectii (foldere) — cel mai apropiat
 * echivalent existent; Proiecte ramane accesibil separat din Meniu pana la o
 * unificare reala a celor doua concepte (schimbare mai mare, nu facuta aici).
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
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);

  if (photos.length === 0) return null;

  // "Acasa" e activ cand niciunul din celelalte 3 tab-uri nu e deschis — nu
  // verificam TOATE panourile posibile din aplicatie (Statistici, Proiecte
  // etc., deschise tot din Meniu), doar starea proprie a acestei bare.
  const isHomeActive = !collectionsOpen && !personsOpen && !menuOpen;
  // Un tap pe "Acasa" (fie din alt tab, fie din grila deschisa) revine mereu
  // la dashboard-ul curat — nu doar inchide celelalte 3 panouri, ci si
  // ascunde grila clasica daca era deschisa (homeGridOpen), la fel cum un tap
  // pe tab-ul activ in alte aplicatii mobile te duce "sus"/la starea initiala.
  const goHome = () => { setCollectionsOpen(false); setPersonsOpen(false); setMenuOpen(false); setHomeGridOpen(false); };

  return (
    <nav className="bottom-nav glass" aria-label={tr('nav.ariaLabel')}>
      <button className={isHomeActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goHome} aria-current={isHomeActive}>
        <HomeIcon />
        <span>{tr('nav.home')}</span>
      </button>
      <button className={collectionsOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={() => setCollectionsOpen(true)} aria-current={collectionsOpen}>
        <FolderIcon />
        <span>{tr('nav.albums')}</span>
      </button>
      <button className={personsOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={() => setPersonsOpen(true)} aria-current={personsOpen}>
        <UserCheckIcon />
        <span>{tr('nav.persons')}</span>
      </button>
      <button className={menuOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={() => setMenuOpen(true)} aria-current={menuOpen}>
        <MenuIcon />
        <span>{tr('nav.me')}</span>
      </button>
    </nav>
  );
}
