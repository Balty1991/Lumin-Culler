import { useRef, type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { isReviewQueue } from '../core/singletonVerdict';
import { HomeIcon, GridIcon, LayersIcon, SparkleIcon } from './icons';
import { t } from '../i18n';

/**
 * Bara de navigare jos — Grilă / Persoane / Export / Setări.
 *
 * Redesign "Lumin Culler PRO" (cerință directă a utilizatorului, cu mockup-uri
 * aprobate): cele 4 taburi urmează acum exact denumirile din capturile
 * confirmate, în locul variantei anterioare (Acasă/Bibliotecă/Revizuiesc/
 * Meniu — vezi istoricul git pentru raționamentul acelei variante, valabil
 * încă pentru echilibrul "ce se folosește des vs. rar", dar înlocuit aici
 * de cerința explicită de fidelitate față de mockup).
 *
 * Nimic nu s-a pierdut, doar s-a redistribuit:
 *  - "Acasă" (ce urmează) rămâne ecranul implicit — dispare doar TAB-ul
 *    dedicat; un tap pe orice tab activ îl închide și revine acolo.
 *  - "Revizuiesc" (sortarea rapidă) rămâne accesibil din pastila "De
 *    verificat" de deasupra grilei (Grilă), unde mockup-ul o arată oricum.
 *  - Persoane și Export au acum tab propriu, ca în mockup, în loc să stea
 *    sub Meniu.
 */
export function BottomNav() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const collectionsOpen = useStore(s => s.collectionsOpen);
  const setCollectionsOpen = useStore(s => s.setCollectionsOpen);
  const personsOpen = useStore(s => s.personsOpen);
  const setPersonsOpen = useStore(s => s.setPersonsOpen);
  const albumsOpen = useStore(s => s.albumsOpen);
  const setAlbumsOpen = useStore(s => s.setAlbumsOpen);
  const aiProfileOpen = useStore(s => s.aiProfileOpen);
  const setAiProfileOpen = useStore(s => s.setAiProfileOpen);
  const menuOpen = useStore(s => s.menuOpen);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const exportDestinationsOpen = useStore(s => s.exportDestinationsOpen);
  const setExportDestinationsOpen = useStore(s => s.setExportDestinationsOpen);
  const homeGridOpen = useStore(s => s.homeGridOpen);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const tiktokSortOpen = useStore(s => s.tiktokSortOpen);
  const setFilter = useStore(s => s.setFilter);
  /** Doar prima intrare din sesiune impune filtrul — vezi goGrid. Hook, deci INAINTE de orice return. */
  const libraryOpenedRef = useRef(false);

  if (photos.length === 0) return null;

  const toReview = photos.filter(p => isReviewQueue(p)).length;

  const closePanels = () => { setCollectionsOpen(false); setPersonsOpen(false); setAlbumsOpen(false); setAiProfileOpen(false); setMenuOpen(false); setExportDestinationsOpen(false); };
  // `!tiktokSortOpen`: revizuirea se deschide PESTE grila — fara conditia asta,
  // Grila ramanea marcata activa si sub sortarea rapida, si bara nu mai spunea
  // unde esti, ci unde ai fost.
  const isGridActive = homeGridOpen && !tiktokSortOpen && !collectionsOpen && !personsOpen && !albumsOpen && !aiProfileOpen && !menuOpen && !exportDestinationsOpen;
  /**
   * "Acasa" e activ cand nu esti nici in grila, nici intr-un panou — adica pe
   * tabloul de bord. Aceeasi conditie ca la Grila, doar cu `homeGridOpen`
   * negat, ca cele doua sa nu poata fi niciodata amandoua active sau amandoua
   * stinse.
   */
  const isHomeActive = !homeGridOpen && !tiktokSortOpen && !collectionsOpen && !personsOpen && !albumsOpen && !aiProfileOpen && !menuOpen && !exportDestinationsOpen;

  /**
   * Grila se deschide pe "De verificat", nu pe "Toate" — cerinta utilizatorului
   * ("cand deschizi biblioteca vreau sa intre direct pe de verificat"), doar la
   * PRIMA intrare din sesiune si doar cand chiar mai e ceva de verificat (vezi
   * ratiunea completa in istoricul git al acestui fisier).
   *
   * Acest buton face UN SINGUR lucru — deschide Grila — dupa ce varianta
   * anterioara (tap pe tab-ul deja activ = inchide) a fost raportata drept
   * confuza de utilizator ("o data ma duce la grila, apas iar ma duce
   * home", doua sensuri pe acelasi buton). Calea inapoi la Acasa e acum un
   * buton DEDICAT si separat, langa cautare/export in antet — vezi App.tsx.
   */
  const goGrid = () => {
    closePanels();
    if (!libraryOpenedRef.current) {
      libraryOpenedRef.current = true;
      if (toReview > 0) setFilter('review');
    }
    setHomeGridOpen(true);
  };
  /**
   * ACASA, in bara de jos — cerinta directa a utilizatorului, si are dreptate:
   * pe telefon navigarea principala tine de degetul mare, iar butonul statea in
   * coltul din dreapta sus, unde nu ajungi fara sa muti mana.
   *
   * NU e o intoarcere la varianta veche, respinsa. Aceea era un SINGUR tab cu
   * doua sensuri ("apas o data ma duce la grila, apas iar ma duce home"), si
   * confuzia venea din asta, nu din locul lui. Aici sunt doua taburi distincte,
   * fiecare cu un singur inteles, si se vede oricand pe care din ele esti.
   */
  const goHome = () => { closePanels(); setHomeGridOpen(false); };
  // Albumele (persoane, animale, evenimente, documente) stăteau ascunse în
  // meniu; utilizatorul nu le-a găsit. Tabul „Persoane” devine „Albume”:
  // persoanele sunt primul rând din ele.
  const goAlbums = () => { closePanels(); setAlbumsOpen(true); };
  // Redesign v3: Export și Setări au ieșit din bară (rămân în capul ecranului);
  // al patrulea tab e modelul tău de AI.
  const goProfile = () => { closePanels(); setAiProfileOpen(true); };

  /**
   * Pastila care marcheaza tabul activ GLISEAZA intre taburi, in loc sa apara
   * si sa dispara.
   *
   * A fost `layoutId` de framer-motion. Miscarea aratata e identica, dar
   * `layoutId` porneste motorul de PROIECTIE al bibliotecii — masoara elemente,
   * compara casete intre randari, si tarste in bundle-ul principal
   * `create-projection-node` + drag + pan: ~107 KB de cod brut incarcat la
   * fiecare pornire, pentru o pastila care se plimba intre patru pozitii fixe si
   * cunoscute dinainte. Bara are taburi de latime egala, deci pozitia nu are ce
   * sa fie masurata: e indexul tabului activ, iar `translateX(index * 100%)` pe
   * o pastila lata cat o coloana o duce fix acolo.
   *
   * NUMARUL de taburi de aici trebuie sa ramana acelasi cu
   * `grid-template-columns` al pistei, in styles.concept.css. Daca se despart,
   * pastila se opreste LANGA tabul activ in loc de peste el — o nepotrivire
   * care nu da nicio eroare, doar arata stramb.
   *
   * Pista e o grila suprapusa peste bara (nu un element in
   * interiorul tabului): pastila ramane UNA singura, deci nu se pot vedea doua
   * in acelasi timp cat tine tranzitia — exact motivul pentru care fundalul
   * propriu al tabului activ e transparent in CSS.
   *
   * Miscarea e doar transform, deci nu reasaza bara. La `prefers-reduced-motion`
   * plasa de siguranta din styles.css scurteaza tranzitia la ~0 (nu o anuleaza),
   * ca inainte.
   */
  const activeIndex = isHomeActive ? 0 : isGridActive ? 1 : albumsOpen ? 2 : aiProfileOpen ? 3 : -1;
  const pastila = (
    <span className="bottom-nav-pill-track" aria-hidden="true">
      <span
        className="bottom-nav-pill"
        data-hidden={activeIndex < 0 ? 'true' : undefined}
        style={{ '--nav-active': Math.max(0, activeIndex) } as CSSProperties}
      />
    </span>
  );

  return (
    <nav className="bottom-nav glass" aria-label={tr('nav.ariaLabel')}>
      {pastila}
      <button className={isHomeActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goHome} aria-current={isHomeActive}>
        <HomeIcon />
        <span>{tr('nav.today')}</span>
      </button>
      <button className={isGridActive ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goGrid} aria-current={isGridActive}>
        <GridIcon />
        <span>{tr('nav.sort')}</span>
        {toReview > 0 && !isGridActive && <b className="bottom-nav-badge mono">{toReview > 99 ? '99+' : toReview}</b>}
      </button>
      <button className={albumsOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goAlbums} aria-current={albumsOpen}>
        <LayersIcon />
        <span>{tr('nav.albums')}</span>
      </button>
      <button className={aiProfileOpen ? 'bottom-nav-tab active' : 'bottom-nav-tab'} onClick={goProfile} aria-current={aiProfileOpen}>
        <SparkleIcon />
        <span>{tr('nav.ai')}</span>
      </button>
    </nav>
  );
}
