import { useMemo } from 'react';
import { useStore } from '../state/store';
import { computeImportStreak } from '../state/streak';
import { findTrips } from '../state/trips';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { AnimatedNumber } from './AnimatedNumber';
import { SparkleIcon, PinIcon } from './icons';
import { t, plural } from '../i18n';

const RECAP_TEASER_MIN_PHOTOS = 5; // sub atat, un "recap" nu chiar inseamna nimic

function greetingKey(hour: number): string {
  if (hour < 5) return 'home.greet.night';
  if (hour < 12) return 'home.greet.morning';
  if (hour < 18) return 'home.greet.afternoon';
  return 'home.greet.evening';
}

/**
 * Zona de "bun venit" de pe Acasa (plan modernizare, cerinta directa a
 * utilizatorului: reorganizare reala, nu doar functii noi bagate in Meniu) —
 * salut + un card-teaser pentru recapul lunar + un rand de mini-statistici
 * reale (zile la rand, calatorii). Randata DOAR cand exista poze (nimic de
 * salutat/rezumat pe o biblioteca goala — vezi WelcomeOnboarding pentru acel caz).
 *
 * Deliberat NU reimplementeaza inelul de progres/"organizat %" din mockup —
 * CullGauge de mai jos (concept HUD, cerut explicit de utilizator intr-o
 * sesiune anterioara) joaca deja acel rol; a-l inlocui ar arunca o decizie
 * de design deja aprobata doar ca sa copieze literal mockup-ul.
 */
export function HomeDashboard() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const setPresentationPhotoIds = useStore(s => s.setPresentationPhotoIds);
  const setPresentationOpen = useStore(s => s.setPresentationOpen);
  const setTripsOpen = useStore(s => s.setTripsOpen);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const now = new Date();
  const streak = useMemo(() => computeImportStreak(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps -- `now` doar ancoreaza calculul, nu trebuie sa retrigger-uiasca la fiecare randare
  const tripCount = useMemo(() => findTrips(photos).length, [photos]);
  const recapPhotos = useMemo(() => selectMonthlyRecap(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (photos.length === 0) return null;

  const reviewCount = photos.filter(p => p.status === 'review').length;
  const openRecap = () => { setPresentationPhotoIds(recapPhotos.map(p => p.id)); setPresentationOpen(true); };

  return (
    <div className="home-dash">
      <div className="home-greet">
        <span className="home-greet-hello">{tr(greetingKey(now.getHours()))}</span>
        {reviewCount > 0 && (
          <span className="home-greet-sub">
            <SparkleIcon className="inline-icon" aria-hidden="true" />{' '}
            {tr(plural(reviewCount, 'home.greet.reviewCount.one', 'home.greet.reviewCount.other'), { count: reviewCount })}
          </span>
        )}
      </div>

      {recapPhotos.length >= RECAP_TEASER_MIN_PHOTOS && (
        <button className="home-recap-card glass" onClick={openRecap}>
          <span className="home-recap-icon" aria-hidden="true">🎬</span>
          <span className="home-recap-text">
            <b>{tr('home.recap.title')}</b>
            <span>{tr(plural(recapPhotos.length, 'home.recap.sub.one', 'home.recap.sub.other'), { count: recapPhotos.length })}</span>
          </span>
        </button>
      )}

      {(streak > 1 || tripCount > 0) && (
        <div className="home-stat-row">
          {streak > 1 && (
            <div className="home-mini-card glass">
              <span className="home-mini-num">🔥 <AnimatedNumber value={streak} /></span>
              <span className="home-mini-lbl">{tr(plural(streak, 'home.streak.label.one', 'home.streak.label.other'), { count: streak })}</span>
            </div>
          )}
          {tripCount > 0 && (
            <button className="home-mini-card glass home-mini-card-btn" onClick={() => setTripsOpen(true)}>
              <span className="home-mini-num"><PinIcon className="inline-icon" aria-hidden="true" /> <AnimatedNumber value={tripCount} /></span>
              <span className="home-mini-lbl">{tr(plural(tripCount, 'home.trips.label.one', 'home.trips.label.other'), { count: tripCount })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
