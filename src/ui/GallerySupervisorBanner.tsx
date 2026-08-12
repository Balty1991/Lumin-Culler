import { useEffect } from 'react';
import { useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { ClockIcon } from './icons';
import { t, type Locale } from '../i18n';

function formatPeriod(startMs: number, endMs: number, locale: Locale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };
  const start = new Date(startMs).toLocaleDateString(intlLocale, opts);
  const end = new Date(endMs).toLocaleDateString(intlLocale, opts);
  return start === end ? start : `${start} – ${end}`;
}

/**
 * "Supervizorul galeriei" (cerinta directa a utilizatorului) — in loc de un
 * import masiv al intregii galerii dintr-o data, recomanda urmatoarea
 * perioada cronologica de ~2 luni (cele mai vechi poze intai) si o aduce
 * DIRECT la un singur tap, fara selector manual — vezi state/gallerySupervisor.ts
 * pentru cursorul care tine minte pana unde s-a ajuns deja. Doar Android nativ
 * (necesita MediaLibraryPlugin.kt:photosInRange, NEVALIDAT inca pe device real).
 */
export function GallerySupervisorBanner() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const galleryDateRange = useStore(s => s.galleryDateRange);
  const loadGalleryDateRange = useStore(s => s.loadGalleryDateRange);
  const nextPeriod = useStore(s => s.supervisorNextPeriod());
  const importNextGalleryPeriod = useStore(s => s.importNextGalleryPeriod);
  const supervisorImporting = useStore(s => s.supervisorImporting);

  useEffect(() => {
    if (isNativeMediaLibraryAvailable() && galleryDateRange === null) void loadGalleryDateRange();
  }, [galleryDateRange, loadGalleryDateRange]);

  if (!isNativeMediaLibraryAvailable() || !nextPeriod) return null;

  return (
    <div className="gallery-supervisor-banner glass">
      <span className="gallery-supervisor-icon" aria-hidden="true"><ClockIcon /></span>
      <span className="gallery-supervisor-text">
        <b>{tr('gallerySupervisor.title')}</b>
        <span>{formatPeriod(nextPeriod.start, nextPeriod.end, locale)}</span>
      </span>
      <button
        className="gallery-supervisor-cta"
        disabled={supervisorImporting}
        onClick={() => void importNextGalleryPeriod()}
      >
        {supervisorImporting ? tr('gallerySupervisor.importing') : tr('gallerySupervisor.cta')}
      </button>
    </div>
  );
}
