import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { findTrips, findPlaces, summarizeTripSearch, TRIP_MIN_DISTANCE_FROM_HOME_KM, type Trip } from '../state/trips';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { XIcon, PinIcon } from './icons';
import { t, plural, type Locale } from '../i18n';

function formatRange(trip: Trip, locale: Locale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString(intlLocale, sameMonth ? { day: '2-digit' } : { day: '2-digit', month: 'short' });
  const endStr = end.toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${startStr} — ${endStr}`;
}

/**
 * Continutul vizual al unei miniaturi — NU un buton propriu (vezi comentariul
 * identic din MemoryBanner.tsx: un <button> imbricat in alt <button> e HTML
 * invalid, browserul inchide automat butonul exterior la primul buton
 * imbricat intalnit — exact bug-ul gasit aici la verificarea vizuala, cardul
 * de calatorie isi pierdea tot continutul de text). Coperta din randul
 * cardului (deja in interiorul butonului de expand/collapse) foloseste asta
 * direct intr-un <span>; grila din card (NU imbricata in alt buton) o
 * infasoara in propriul <button>, mai jos.
 */
function TripThumbImage({ photoId }: { photoId: string }) {
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

function TripCard({ trip, locale, onOpenPhoto }: { trip: Trip; locale: Locale; onOpenPhoto: (id: string) => void }) {
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [expanded, setExpanded] = useState(false);
  const cover = trip.photos[0];
  const dayCount = new Set(trip.photos.map(p => new Date(p.capturedAt!).toDateString())).size;

  return (
    <li className="trip-card">
      <button className="trip-card-main" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span className="memory-thumb trip-thumb">
          <TripThumbImage photoId={cover.id} />
        </span>
        <span className="trip-card-info">
          <span className="trip-card-range">{formatRange(trip, locale)}</span>
          <span className="trip-card-sub">
            <PinIcon className="inline-icon" aria-hidden="true" />
            {trip.isHome ? tr('trips.place.home') : tr('trips.distance', { km: Math.round(trip.distanceFromHomeKm) })}
            {' · '}
            {tr(plural(dayCount, 'trips.days.one', 'trips.days.other'), { count: dayCount })}
            {' · '}
            {tr(plural(trip.photos.length, 'trips.photos.one', 'trips.photos.other'), { count: trip.photos.length })}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="trip-card-grid">
          {trip.photos.map(photo => (
            <button key={photo.id} className="memory-thumb" aria-label={photo.fileName} onClick={() => onOpenPhoto(photo.id)}>
              <TripThumbImage photoId={photo.id} />
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * "Calatorii" (plan modernizare) — grupare automata pe baza EXIF (data + GPS),
 * fara niciun modul/permisiune noua. Vezi state/trips.ts pentru logica de
 * grupare (aproximare simpla, nu clustering geografic real — comentata acolo).
 */
export function TripsPanel() {
  const open = useStore(s => s.tripsOpen);
  const setOpen = useStore(s => s.setTripsOpen);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const trips = useMemo(() => findTrips(photos), [photos]);
  // Calculat doar cand chiar nu s-a gasit nimic — vezi summarizeTripSearch:
  // "nimic" are trei cauze diferite si doar una e o problema.
  // Locurile se calculeaza doar cand nu exista nicio calatorie — ecranul arata
  // atunci ce STIE (unde s-au facut pozele), nu doar ce n-a gasit.
  const places = useMemo(() => (trips.length === 0 ? findPlaces(photos) : []), [trips, photos]);
  const emptyReason = useMemo(() => {
    if (trips.length > 0) return '';
    const s = summarizeTripSearch(photos);
    if (s.withLocation === 0) {
      return photos.length ? tr('trips.empty.noLocation', { total: photos.length }) : tr('trips.empty');
    }
    if (s.multiDayGroups === 0) return tr('trips.empty.singleDay', { count: s.withLocation });
    return tr('trips.empty.tooClose', {
      count: s.withLocation,
      km: Math.round(s.farthestGroupKm ?? 0),
      threshold: TRIP_MIN_DISTANCE_FROM_HOME_KM
    });
  }, [trips, photos, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- `tr` se schimba la fiecare randare; `locale` e ce conteaza

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const openPhoto = (id: string) => { setOpen(false); openDetail(id); };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('menu.trips')} tabIndex={-1}>
        <header className="detail-head">
          <span><PinIcon className="inline-icon" aria-hidden="true" /> {tr('menu.trips')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>
        {trips.length > 0 ? (
          <ul className="trips-list">
            {trips.map(trip => (
              <TripCard key={trip.photos[0].id} trip={trip} locale={locale} onOpenPhoto={openPhoto} />
            ))}
          </ul>
        ) : (
          <>
            <p className="hint">{emptyReason}</p>
            {places.length > 0 && (
              <>
                <div className="drawer-section-label">{tr('trips.places.title')}</div>
                <p className="hint">{tr('trips.places.hint')}</p>
                <ul className="trips-list">
                  {places.map(place => (
                    <TripCard key={place.photos[0].id} trip={place} locale={locale} onOpenPhoto={openPhoto} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
