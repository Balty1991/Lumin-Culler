import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { findLocations, NO_LOCATION_KEY, type PhotoLocationGroup } from '../state/locations';
import { hasRealGps } from '../core/gpsCoordinates';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { findNearestPlace, formatPlace, loadPlaceIndex } from '../core/placeNames';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { XIcon, PinIcon, FolderIcon } from './icons';
import { t, plural, type Locale } from '../i18n';

/** Intervalul de date al unei grupe. Absent daca nicio poza din grupa n-are data capturii. */
function formatRange(group: PhotoLocationGroup, locale: Locale): string {
  if (group.startDate === undefined || group.endDate === undefined) return '';
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  const start = new Date(group.startDate);
  const end = new Date(group.endDate);
  const sameDay = start.toDateString() === end.toDateString();
  const endStr = end.toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
  if (sameDay) return endStr;
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString(intlLocale, sameMonth ? { day: '2-digit' } : { day: '2-digit', month: 'short' });
  return `${startStr} — ${endStr}`;
}

/**
 * Continutul vizual al unei miniaturi — NU un buton propriu (vezi comentariul
 * identic din MemoryBanner.tsx: un <button> imbricat in alt <button> e HTML
 * invalid, browserul inchide automat butonul exterior la primul buton
 * imbricat intalnit — exact bug-ul gasit aici la verificarea vizuala, cardul
 * isi pierdea tot continutul de text). Coperta din randul cardului (deja in
 * interiorul butonului de expand/collapse) foloseste asta direct intr-un
 * <span>; grila din card (NU imbricata in alt buton) o infasoara in propriul
 * <button>, mai jos.
 */
function LocationThumbImage({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => {
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage src={src} alt="" loading="lazy" /> : <span className="memory-thumb-loading" aria-hidden="true" />;
}

function LocationCard({ group, placeName, locale, premiumLocked, onOpenPhoto, onMakeFolder, onReimportGps }: {
  group: PhotoLocationGroup; placeName?: string; locale: Locale;
  /** Doar ETICHETA butonului. Blocarea efectiva sta in store (createCollectionFromLocation) — vezi acolo de ce. */
  premiumLocked: boolean;
  onOpenPhoto: (id: string) => void;
  onMakeFolder: (name: string, photoIds: string[]) => void;
  /** Doar pe Android nativ: acolo exista un MediaStore din care EXIF-ul se poate reciti. */
  onReimportGps?: () => void;
}) {
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [expanded, setExpanded] = useState(false);
  const cover = group.photos[0];
  const dayCount = new Set(
    group.photos.map(p => (p.capturedAt === undefined ? '' : new Date(p.capturedAt).toDateString()))
  ).size;
  const range = formatRange(group, locale);

  // Titlul spune LOCUL, nu data: e un ecran de locatii, iar data e detaliu.
  // Numele localitatii cand il stim (vezi core/reverseGeocode.ts); altfel —
  // fara retea, fara serviciu de geocodare — relatia cu zona in care faci de
  // obicei poze, singurul reper care se calculeaza local.
  const fallbackTitle = !group.hasLocation
    ? tr('locations.none')
    : group.isHome
      ? tr('locations.home')
      : tr('locations.distance', { km: Math.round(group.distanceFromHomeKm ?? 0) });
  const title = group.hasLocation && placeName ? placeName : fallbackTitle;

  return (
    <li className="location-card">
      <button className="location-card-main" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span className="memory-thumb location-thumb">
          <LocationThumbImage photoId={cover.id} />
        </span>
        <span className="location-card-info">
          <span className="location-card-title">
            <PinIcon className="inline-icon" aria-hidden="true" />
            {title}
          </span>
          <span className="location-card-sub">
            {group.hasLocation && placeName && !group.isHome && (
              <>{tr('locations.distance', { km: Math.round(group.distanceFromHomeKm ?? 0) })}{' · '}</>
            )}
            {range && <>{range}{' · '}</>}
            {tr(plural(group.photos.length, 'locations.photos.one', 'locations.photos.other'), { count: group.photos.length })}
            {range && dayCount > 1 && <>{' · '}{tr(plural(dayCount, 'locations.days.one', 'locations.days.other'), { count: dayCount })}</>}
          </span>
          {/* Coordonatele, ca ai unde sa le verifici — aceeasi informatie pe
              care o arata si panoul de informatii al pozei. */}
          {group.hasLocation && (
            <span className="location-card-coords mono">
              {group.centroidLat!.toFixed(3)}, {group.centroidLon!.toFixed(3)}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <>
          {!group.hasLocation && <p className="hint">{tr('locations.none.hint')}</p>}
          {/* Grupul fara coordonate: spunem ce NU se poate (GPS-ul lipsa nu se
              reconstruieste) inainte sa oferim ce se poate. Fara asta, butonul
              de mai jos parea ca "repara" locatia. */}
          {!group.hasLocation && <p className="location-nogps-note">{tr('locations.noGps.fallback')}</p>}
          {/* Aici, nu pe randul cardului: randul E deja un buton (expand), iar
              un <button> in alt <button> e HTML invalid — vezi comentariul de
              la LocationThumbImage, acelasi bug prins o data. */}
          <button
            className="ghost location-card-folder"
            title={tr('locations.makeFolder.title')}
            onClick={() => onMakeFolder(title, group.photos.map(p => p.id))}
          >
            <FolderIcon className="inline-icon" aria-hidden="true" />{' '}
            {tr(group.hasLocation ? 'locations.makeFolder' : 'locations.makeFolder.byDate')}
            {premiumLocked && <span className="location-folder-premium"> · {tr('premium.chip')}</span>}
          </button>
          {!group.hasLocation && onReimportGps && (
            <button className="ghost location-card-folder location-reimport-gps" onClick={onReimportGps}>
              {tr('locations.reimportGps')}
            </button>
          )}
          <div className="location-card-grid">
            {group.photos.map(photo => (
              <button key={photo.id} className="memory-thumb" aria-label={photo.fileName} onClick={() => onOpenPhoto(photo.id)}>
                <LocationThumbImage photoId={photo.id} />
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * "Locatii" — pozele importate, grupate dupa locul unde au fost facute, plus o
 * grupa separata pentru cele fara coordonate. A inlocuit "Calatorii" (cerinta
 * directa a utilizatorului): calatoria era o notiune ingusta, iar ecranul
 * ramanea gol la nesfarsit pentru o biblioteca obisnuita, fara sa fie nimic
 * stricat. Vezi state/locations.ts pentru gruparea propriu-zisa.
 */
export function LocationsPanel() {
  const open = useStore(s => s.locationsOpen);
  const setOpen = useStore(s => s.setLocationsOpen);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const createCollectionFromLocation = useStore(s => s.createCollectionFromLocation);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  const premiumLocked = useStore(s => s.premiumLocked);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  /**
   * Localitatea fiecarei poze, cautata in lista inclusa in aplicatie. Pe ea se
   * face si gruparea (vezi findLocations): doua poze din acelasi oras stau
   * impreuna chiar daca au coordonate la sute de metri una de alta — asa sunt
   * coordonatele scrise de telefon, si nu e un motiv sa apara doua "locatii".
   */
  const [photoPlaces, setPhotoPlaces] = useState<Map<string, string>>(new Map());
  const groups = useMemo(() => findLocations(photos, photoPlaces), [photos, photoPlaces]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadPlaceIndex().then(index => {
      if (!alive || !index) return;
      const places = new Map<string, string>();
      for (const photo of photos) {
        if (!hasRealGps(photo.gpsLatitude, photo.gpsLongitude)) continue;
        const place = findNearestPlace(index, photo.gpsLatitude!, photo.gpsLongitude!);
        if (place) places.set(photo.id, formatPlace(place, locale, near => tr('locations.near', { place: near })));
      }
      setPhotoPlaces(places);
    });
    return () => { alive = false; };
  }, [open, photos, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- `tr` se reface la fiecare randare; `locale` e ce conteaza

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const openPhoto = (id: string) => { setOpen(false); openDetail(id); };
  // Ecranul RAMANE deschis: cine face un folder dintr-un loc vrea de obicei sa
  // faca si din urmatorul, iar confirmarea vine oricum din notificarea globala.
  const makeFolder = (name: string, photoIds: string[]) => { void createCollectionFromLocation(name, photoIds); };
  const hasRealPlaces = groups.some(g => g.key !== NO_LOCATION_KEY);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.locations')} tabIndex={-1}>
        <header className="detail-head">
          <span><PinIcon className="inline-icon" aria-hidden="true" /> {tr('menu.locations')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>
        {groups.length === 0 ? (
          <p className="hint">{tr('locations.empty')}</p>
        ) : (
          <>
            {hasRealPlaces && (
              <p className="hint">
                {tr('locations.hint')}{' '}{tr('locations.hint.offline')}
              </p>
            )}
            <ul className="locations-list">
              {groups.map(group => (
                <LocationCard
                  key={group.key}
                  group={group}
                  placeName={photoPlaces.get(group.photos[0].id)}
                  locale={locale}
                  onOpenPhoto={openPhoto}
                  premiumLocked={premiumLocked}
                  onMakeFolder={makeFolder}
                  onReimportGps={isNativeMediaLibraryAvailable()
                    ? () => { setOpen(false); setSupervisorPanelOpen(true); }
                    : undefined}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
