import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import {
  readSupervisorBannerDismissedDate, writeSupervisorBannerDismissedDate, isSupervisorBannerDismissedToday
} from '../state/gallerySupervisor';
import { ClockIcon, XIcon } from './icons';
import { t, plural, type Locale } from '../i18n';

export function formatPeriod(startMs: number, endMs: number, locale: Locale): string {
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };
  const start = new Date(startMs).toLocaleDateString(intlLocale, opts);
  const end = new Date(endMs).toLocaleDateString(intlLocale, opts);
  return start === end ? start : `${start} – ${end}`;
}

/**
 * "Supervizorul galeriei" (cerinta directa a utilizatorului) — in loc de un
 * import masiv al intregii galerii dintr-o data, recomanda urmatoarea
 * perioada cronologica (lungime aleasa de utilizator — vezi
 * GallerySupervisorPanel.tsx) si o aduce DIRECT la un singur tap, fara
 * selector manual — vezi state/gallerySupervisor.ts pentru cursorul care
 * tine minte pana unde s-a ajuns deja. Doar Android nativ (necesita
 * MediaLibraryPlugin.kt:photosInRange, NEVALIDAT inca pe device real).
 *
 * Inchidere DOAR pentru ziua curenta (cerinta directa: "sa il poti inchide
 * daca vrei si ulterior sa il gasesti in meniul aplicatiei") — panoul complet
 * ramane accesibil oricand din Meniu (setSupervisorPanelOpen), indiferent
 * daca bannerul a fost inchis azi.
 */
export function GallerySupervisorBanner() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const galleryDateRange = useStore(s => s.galleryDateRange);
  const loadGalleryDateRange = useStore(s => s.loadGalleryDateRange);
  const nextPeriod = useStore(s => s.supervisorNextPeriod());
  const coveragePercent = useStore(s => s.supervisorCoveragePercent());
  const importNextGalleryPeriod = useStore(s => s.importNextGalleryPeriod);
  const supervisorImporting = useStore(s => s.supervisorImporting);
  const setSupervisorPanelOpen = useStore(s => s.setSupervisorPanelOpen);
  const lastSupervisorImportIds = useStore(s => s.lastSupervisorImportIds);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const photoCount = useStore(s => s.photos.length);
  const [dismissedToday, setDismissedToday] = useState(() => isSupervisorBannerDismissedToday(readSupervisorBannerDismissedDate()));

  useEffect(() => {
    if (isNativeMediaLibraryAvailable() && galleryDateRange === null) void loadGalleryDateRange();
  }, [galleryDateRange, loadGalleryDateRange]);

  const sortNowCount = lastSupervisorImportIds?.length ?? 0;

  // Nu si pe ecranul gol: acolo exista deja butonul "Adu pe perioade", langa
  // "Alege fotografiile" (cerinta directa) — bannerul ar fi a doua copie a
  // aceleiasi actiuni, peste continutul de start.
  if (photoCount === 0) return null;
  if (!isNativeMediaLibraryAvailable() || dismissedToday || (!nextPeriod && sortNowCount === 0)) return null;

  const dismiss = () => { writeSupervisorBannerDismissedDate(); setDismissedToday(true); };

  return (
    <div className="gallery-supervisor-banner glass">
      {sortNowCount > 0 && (
        <button type="button" className="gallery-supervisor-sortnow" onClick={() => openTiktokSortForIds(lastSupervisorImportIds!)}>
          {tr(plural(sortNowCount, 'gallerySupervisor.sortNow.one', 'gallerySupervisor.sortNow.other'), { count: sortNowCount })}
        </button>
      )}
      {nextPeriod ? (
        <>
          <div className="gallery-supervisor-row">
            <button
              type="button"
              className="gallery-supervisor-main"
              onClick={() => setSupervisorPanelOpen(true)}
              aria-label={tr('gallerySupervisor.openPanel')}
            >
              <span className="gallery-supervisor-icon" aria-hidden="true"><ClockIcon /></span>
              <span className="gallery-supervisor-text">
                <b>{tr('gallerySupervisor.title')}</b>
                <span>{formatPeriod(nextPeriod.start, nextPeriod.end, locale)}</span>
                <span className="gallery-supervisor-progress" role="progressbar" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100} aria-label={tr('gallerySupervisor.coverage', { percent: coveragePercent })}>
                  <span className="gallery-supervisor-progress-fill" style={{ width: `${coveragePercent}%` }} />
                </span>
              </span>
            </button>
            <button className="ghost icon-btn gallery-supervisor-close" onClick={dismiss} aria-label={tr('gallerySupervisor.dismiss')}>
              <XIcon />
            </button>
          </div>
          <button
            className="gallery-supervisor-cta"
            disabled={supervisorImporting}
            onClick={() => void importNextGalleryPeriod()}
          >
            {supervisorImporting ? tr('gallerySupervisor.importing') : tr('gallerySupervisor.cta')}
          </button>
        </>
      ) : (
        <button className="ghost icon-btn gallery-supervisor-close" onClick={dismiss} aria-label={tr('gallerySupervisor.dismiss')}>
          <XIcon />
        </button>
      )}
    </div>
  );
}
