import { useMemo, useState, type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { computeImportStreak } from '../state/streak';
import { findTrips } from '../state/trips';
import { selectMonthlyRecap } from '../state/monthlyRecap';
import { selectDeletableRejected } from '../state/batchOps';
import { sumKnownSizeBytes, formatGB } from '../state/storageStats';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { selectPendingShieldReview, readShieldDismissedIds } from '../core/documentShield';
import { selectUnresolvedGroups } from '../state/duplicateGroups';
import { AnimatedNumber } from './AnimatedNumber';
import { GalleryOverviewNote } from './GalleryOverviewNote';
import { SparkleIcon, PinIcon, ChevronUpIcon, ShieldIcon, CopyIcon } from './icons';
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
 * utilizatorului: reorganizare reala vizuala, dupa mockup-ul HTML trimis —
 * card hero de progres + spatiu, card recap, card sterge respinse, rand de
 * mini-statistici). Randata DOAR cand exista poze (nimic de salutat/rezumat
 * pe o biblioteca goala — vezi WelcomeOnboarding pentru acel caz).
 *
 * Toate cifrele sunt reale, nu inventate ca sa semene cu mockup-ul:
 * - "%" organizat = (selectate+respinse)/total, acelasi calcul ca CullGauge.
 * - "GB" ocupate/eliberate = suma reala PhotoView.sizeBytes (File.size la
 *   import) — vezi state/storageStats.ts. Poze importate INAINTE de acest
 *   camp nu au sizeBytes si sunt excluse din suma, nu numarate ca 0.
 * - streak/calatorii/recap — vezi state/streak.ts, state/trips.ts,
 *   state/monthlyRecap.ts, deja construite.
 */
export function HomeDashboard() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const setPresentationPhotoIds = useStore(s => s.setPresentationPhotoIds);
  const setPresentationOpen = useStore(s => s.setPresentationOpen);
  const setTripsOpen = useStore(s => s.setTripsOpen);
  const setTiktokSortOpen = useStore(s => s.setTiktokSortOpen);
  const setDocumentShieldOpen = useStore(s => s.setDocumentShieldOpen);
  const setDuplicatesPanelOpen = useStore(s => s.setDuplicatesPanelOpen);
  const collections = useStore(s => s.collections);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const askConfirm = useStore(s => s.askConfirm);
  const [deleting, setDeleting] = useState(false);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const now = new Date();
  const streak = useMemo(() => computeImportStreak(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps -- `now` doar ancoreaza calculul, nu trebuie sa retrigger-uiasca la fiecare randare
  const tripCount = useMemo(() => findTrips(photos).length, [photos]);
  const recapPhotos = useMemo(() => selectMonthlyRecap(photos, now), [photos]); // eslint-disable-line react-hooks/exhaustive-deps
  const { deletable: deletableRejected } = useMemo(() => selectDeletableRejected(photos), [photos]);
  const shieldPendingCount = useMemo(() => {
    const vaultIds = new Set(collections.find(c => c.isPrivate)?.memberIds ?? []);
    return selectPendingShieldReview(photos, vaultIds, readShieldDismissedIds()).length;
  }, [photos, collections]);
  const duplicateGroupCount = useMemo(() => selectUnresolvedGroups(photos).length, [photos]);

  if (photos.length === 0) return null;

  // "de curatat" = tot ce nu e inca decis (pending + review), nu doar 'review'
  // (subsetul ambiguu semnalat de AI) — altfel numarul arata mult mai mic
  // decat coada reala de sortat pe care utilizatorul chiar o are.
  const unsortedCount = photos.filter(p => p.status === 'pending' || p.status === 'review').length;
  const decidedCount = photos.filter(p => p.status === 'selected' || p.status === 'rejected').length;
  const donePercent = Math.round((decidedCount / Math.max(1, photos.length)) * 100);
  const totalGB = formatGB(sumKnownSizeBytes(photos));
  const freedGB = formatGB(sumKnownSizeBytes(deletableRejected));

  const openRecap = () => { setPresentationPhotoIds(recapPhotos.map(p => p.id)); setPresentationOpen(true); };
  const doDelete = async () => {
    const ok = await askConfirm(tr('batch.deleteRejected.confirm', { count: deletableRejected.length }), { confirmLabel: tr('home.delete.cta'), danger: true });
    if (!ok) return;
    setDeleting(true);
    try { await deleteRejectedPhotos(); } finally { setDeleting(false); }
  };

  return (
    <div className="home-dash">
      <div className="home-greet">
        <span className="home-greet-hello">{tr(greetingKey(now.getHours()))}</span>
        {unsortedCount > 0 && (
          <span className="home-greet-sub">
            <SparkleIcon className="inline-icon" aria-hidden="true" />{' '}
            {tr(plural(unsortedCount, 'home.greet.unsorted.one', 'home.greet.unsorted.other'), { count: unsortedCount })}
          </span>
        )}
      </div>

      <div className="home-hero-card glass">
        <div className="home-hero-main">
          <div className="home-hero-num">{donePercent}%</div>
          <div className="home-hero-lbl">{tr('home.hero.label')}</div>
        </div>
        <div className="home-hero-ring" style={{ '--pct-deg': `${donePercent * 3.6}deg` } as CSSProperties}>
          <b>{totalGB}GB</b>
        </div>
      </div>

      <GalleryOverviewNote />

      {unsortedCount > 0 && (
        <button className="home-sort-cta" onClick={() => setTiktokSortOpen(true)}>
          <span className="home-sort-icon" aria-hidden="true"><ChevronUpIcon /></span>
          <span className="home-sort-text">
            <b>{tr('home.sortCta.title')}</b>
            <span>{tr(plural(unsortedCount, 'home.sortCta.sub.one', 'home.sortCta.sub.other'), { count: unsortedCount })}</span>
          </span>
          <span className="home-sort-go">{tr('home.sortCta.go')}</span>
        </button>
      )}

      {recapPhotos.length >= RECAP_TEASER_MIN_PHOTOS && (
        <button className="home-recap-card glass" onClick={openRecap}>
          <span className="home-recap-icon" aria-hidden="true">🎬</span>
          <span className="home-recap-text">
            <b>{tr('home.recap.title')}</b>
            <span>{tr(plural(recapPhotos.length, 'home.recap.sub.one', 'home.recap.sub.other'), { count: recapPhotos.length })}</span>
          </span>
        </button>
      )}

      {isNativeMediaLibraryAvailable() && deletableRejected.length > 0 && (
        <div className="home-delete-cta">
          <span className="home-delete-text">
            <b>{tr(plural(deletableRejected.length, 'home.delete.title.one', 'home.delete.title.other'), { count: deletableRejected.length })}</b>
            <span>{tr('home.delete.sub', { gb: freedGB })}</span>
          </span>
          <button className="home-delete-go" disabled={deleting} onClick={() => void doDelete()}>
            {tr('home.delete.cta')}
          </button>
        </div>
      )}

      {shieldPendingCount > 0 && (
        <button className="home-shield-cta" onClick={() => setDocumentShieldOpen(true)}>
          <span className="home-shield-icon" aria-hidden="true"><ShieldIcon /></span>
          <span className="home-shield-text">
            <b>{tr(plural(shieldPendingCount, 'shield.home.title.one', 'shield.home.title.other'), { count: shieldPendingCount })}</b>
            <span>{tr('shield.home.sub')}</span>
          </span>
        </button>
      )}

      {(streak > 1 || tripCount > 0 || duplicateGroupCount > 0) && (
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
          {duplicateGroupCount > 0 && (
            <button className="home-mini-card glass home-mini-card-btn" onClick={() => setDuplicatesPanelOpen(true)}>
              <span className="home-mini-num"><CopyIcon className="inline-icon" aria-hidden="true" /> <AnimatedNumber value={duplicateGroupCount} /></span>
              <span className="home-mini-lbl">{tr(plural(duplicateGroupCount, 'duplicates.count.one', 'duplicates.count.other'), { count: duplicateGroupCount })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
