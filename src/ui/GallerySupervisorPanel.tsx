import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { isPeriodAlreadyCovered, PERIOD_MONTH_OPTIONS, type GalleryPeriod, type PeriodMonths } from '../state/gallerySupervisor';
import { formatPeriod } from './GallerySupervisorBanner';
import { ClockIcon, XIcon, FolderIcon, CheckIcon } from './icons';
import { t, plural } from '../i18n';

/**
 * Panoul complet al "Supervizorului galeriei" — cerinta directa a
 * utilizatorului: lungime de perioada aleasa (1/2/3 luni), selector
 * calendaristic peste TOATE perioadele (nu doar cea recomandata), cu
 * confirmare inainte de a re-aduce o perioada deja acoperita, plus foldere
 * din galerie ca alternativa la segmentarea cronologica. Redeschis oricand
 * din Meniu (bannerul de pe Acasa poate fi inchis doar pentru ziua curenta —
 * vezi GallerySupervisorBanner.tsx).
 */
export function GallerySupervisorPanel() {
  const open = useStore(s => s.supervisorPanelOpen);
  const setOpen = useStore(s => s.setSupervisorPanelOpen);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  const galleryDateRange = useStore(s => s.galleryDateRange);
  const loadGalleryDateRange = useStore(s => s.loadGalleryDateRange);
  const supervisorPeriodMonths = useStore(s => s.supervisorPeriodMonths);
  const setSupervisorPeriodMonths = useStore(s => s.setSupervisorPeriodMonths);
  const supervisorCoveredUntil = useStore(s => s.supervisorCoveredUntil);
  const nextPeriod = useStore(s => s.supervisorNextPeriod());
  const allPeriods = useStore(s => s.supervisorAllPeriods());
  const importGalleryPeriod = useStore(s => s.importGalleryPeriod);
  const supervisorImporting = useStore(s => s.supervisorImporting);
  const askConfirm = useStore(s => s.askConfirm);

  const galleryFolders = useStore(s => s.galleryFolders);
  const loadGalleryFolders = useStore(s => s.loadGalleryFolders);
  const importGalleryFolder = useStore(s => s.importGalleryFolder);

  useEffect(() => {
    if (!open || !isNativeMediaLibraryAvailable()) return;
    if (galleryDateRange === null) void loadGalleryDateRange();
    if (galleryFolders === null) void loadGalleryFolders();
  }, [open, galleryDateRange, loadGalleryDateRange, galleryFolders, loadGalleryFolders]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const bringPeriod = async (period: GalleryPeriod) => {
    if (supervisorImporting) return;
    if (isPeriodAlreadyCovered(period, supervisorCoveredUntil)) {
      const ok = await askConfirm(tr('gallerySupervisor.alreadyCovered.confirm', { period: formatPeriod(period.start, period.end, locale) }));
      if (!ok) return;
    }
    await importGalleryPeriod(period);
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow supervisor-panel" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('gallerySupervisor.panelTitle')} tabIndex={-1}>
        <header className="detail-head">
          <span><ClockIcon className="inline-icon" aria-hidden="true" /> {tr('gallerySupervisor.panelTitle')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {!isNativeMediaLibraryAvailable() ? (
          <p className="hint">{tr('gallerySupervisor.nativeOnly')}</p>
        ) : (
          <>
            <div className="supervisor-section">
              <div className="supervisor-section-label">{tr('gallerySupervisor.periodLength')}</div>
              <div className="supervisor-chips">
                {PERIOD_MONTH_OPTIONS.map(months => (
                  <button
                    key={months}
                    type="button"
                    className={supervisorPeriodMonths === months ? 'chip active' : 'chip'}
                    onClick={() => setSupervisorPeriodMonths(months as PeriodMonths)}
                  >
                    {tr(plural(months, 'gallerySupervisor.months.one', 'gallerySupervisor.months.other'), { count: months })}
                  </button>
                ))}
              </div>
            </div>

            {nextPeriod && (
              <button
                type="button"
                className="gallery-supervisor-banner glass supervisor-next-card"
                disabled={supervisorImporting}
                onClick={() => void bringPeriod(nextPeriod)}
              >
                <span className="gallery-supervisor-icon" aria-hidden="true"><ClockIcon /></span>
                <span className="gallery-supervisor-text">
                  <b>{tr('gallerySupervisor.title')}</b>
                  <span>{formatPeriod(nextPeriod.start, nextPeriod.end, locale)}</span>
                </span>
              </button>
            )}

            {allPeriods.length > 0 && (
              <div className="supervisor-section">
                <div className="supervisor-section-label">{tr('gallerySupervisor.calendar')}</div>
                <div className="supervisor-period-list">
                  {allPeriods.map(period => (
                    <button
                      key={period.start}
                      type="button"
                      className="supervisor-period-row"
                      disabled={supervisorImporting}
                      onClick={() => void bringPeriod(period)}
                    >
                      <span>{formatPeriod(period.start, period.end, locale)}</span>
                      {period.covered && (
                        <span className="supervisor-period-covered">
                          <CheckIcon className="inline-icon" aria-hidden="true" /> {tr('gallerySupervisor.covered')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {galleryFolders?.granted && galleryFolders.folders.length > 0 && (
              <div className="supervisor-section">
                <div className="supervisor-section-label">{tr('gallerySupervisor.folders')}</div>
                <div className="supervisor-period-list">
                  {galleryFolders.folders.map(folder => (
                    <button
                      key={folder.id}
                      type="button"
                      className="supervisor-period-row"
                      disabled={supervisorImporting}
                      onClick={() => void importGalleryFolder(folder.id)}
                    >
                      <span><FolderIcon className="inline-icon" aria-hidden="true" /> {folder.name}</span>
                      <span className="mono">{tr(plural(folder.count, 'gallerySupervisor.folderCount.one', 'gallerySupervisor.folderCount.other'), { count: folder.count })}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
