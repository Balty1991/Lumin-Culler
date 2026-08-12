import { useEffect, useRef, type MouseEvent } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { isPeriodAlreadyCovered, PERIOD_MONTH_OPTIONS, type GalleryPeriod, type PeriodMonths } from '../state/gallerySupervisor';
import { formatPeriod } from './GallerySupervisorBanner';
import { ClockIcon, XIcon, FolderIcon, CheckIcon, GridIcon } from './icons';
import { t, plural } from '../i18n';

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** 0.5/12 sunt cazuri speciale ("2 saptamani"/"1 an"), nu doar "N luni" — restul folosesc pluralul normal. */
function periodMonthsLabel(months: PeriodMonths, tr: Tr): string {
  if (months === 0.5) return tr('gallerySupervisor.months.half');
  if (months === 12) return tr('gallerySupervisor.months.year');
  return tr(plural(months, 'gallerySupervisor.months.one', 'gallerySupervisor.months.other'), { count: months });
}

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
  const remainingPeriod = useStore(s => s.supervisorRemainingPeriod());
  const importGalleryPeriod = useStore(s => s.importGalleryPeriod);
  const supervisorImporting = useStore(s => s.supervisorImporting);
  const askConfirm = useStore(s => s.askConfirm);

  const galleryFolders = useStore(s => s.galleryFolders);
  const loadGalleryFolders = useStore(s => s.loadGalleryFolders);
  const importGalleryFolder = useStore(s => s.importGalleryFolder);
  const importAllGalleryFolders = useStore(s => s.importAllGalleryFolders);
  const supervisorImportedFolderIds = useStore(s => s.supervisorImportedFolderIds);
  const skipGalleryPeriod = useStore(s => s.skipGalleryPeriod);
  const lastSupervisorImportIds = useStore(s => s.lastSupervisorImportIds);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);

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

  const bringRemaining = async () => {
    if (!remainingPeriod || supervisorImporting) return;
    const ok = await askConfirm(tr('gallerySupervisor.remaining.confirm', { period: formatPeriod(remainingPeriod.start, remainingPeriod.end, locale) }));
    if (!ok) return;
    await importGalleryPeriod(remainingPeriod);
  };

  const skipPeriod = async (period: GalleryPeriod, e?: MouseEvent) => {
    e?.stopPropagation();
    if (supervisorImporting) return;
    const ok = await askConfirm(tr('gallerySupervisor.skip.confirm', { period: formatPeriod(period.start, period.end, locale) }));
    if (!ok) return;
    skipGalleryPeriod(period);
  };

  const uncoveredFolders = (galleryFolders?.folders ?? []).filter(f => !supervisorImportedFolderIds.has(f.id));

  const bringAllFolders = async () => {
    if (supervisorImporting || !uncoveredFolders.length) return;
    const total = uncoveredFolders.reduce((sum, f) => sum + f.count, 0);
    const ok = await askConfirm(tr('gallerySupervisor.allFolders.confirm', { count: total }));
    if (!ok) return;
    await importAllGalleryFolders();
  };

  const bringFolder = async (folder: { id: string; name: string; count: number }) => {
    if (supervisorImporting) return;
    if (supervisorImportedFolderIds.has(folder.id)) {
      const ok = await askConfirm(tr('gallerySupervisor.folderCovered.confirm', { name: folder.name }));
      if (!ok) return;
    }
    await importGalleryFolder(folder.id);
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
                    {periodMonthsLabel(months as PeriodMonths, tr)}
                  </button>
                ))}
              </div>
            </div>

            {lastSupervisorImportIds && lastSupervisorImportIds.length > 0 && (
              <button
                type="button"
                className="ghost supervisor-sortnow-cta"
                onClick={() => openTiktokSortForIds(lastSupervisorImportIds)}
              >
                {tr(plural(lastSupervisorImportIds.length, 'gallerySupervisor.sortNow.one', 'gallerySupervisor.sortNow.other'), { count: lastSupervisorImportIds.length })}
              </button>
            )}

            {nextPeriod && (
              <div className="gallery-supervisor-banner glass supervisor-next-card">
                <button
                  type="button"
                  className="gallery-supervisor-main"
                  disabled={supervisorImporting}
                  onClick={() => void bringPeriod(nextPeriod)}
                >
                  <span className="gallery-supervisor-icon" aria-hidden="true"><ClockIcon /></span>
                  <span className="gallery-supervisor-text">
                    <b>{tr('gallerySupervisor.title')}</b>
                    <span>{formatPeriod(nextPeriod.start, nextPeriod.end, locale)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="ghost small supervisor-skip-btn"
                  disabled={supervisorImporting}
                  onClick={e => void skipPeriod(nextPeriod, e)}
                >
                  {tr('gallerySupervisor.skip')}
                </button>
              </div>
            )}

            {remainingPeriod && (
              <button type="button" className="ghost supervisor-remaining-cta" disabled={supervisorImporting} onClick={() => void bringRemaining()}>
                {tr('gallerySupervisor.remaining.cta', { period: formatPeriod(remainingPeriod.start, remainingPeriod.end, locale) })}
              </button>
            )}

            {allPeriods.length > 0 && (
              <div className="supervisor-section">
                <div className="supervisor-section-label">{tr('gallerySupervisor.calendar')}</div>
                <div className="supervisor-period-list">
                  {allPeriods.map(period => (
                    <div key={period.start} className="supervisor-period-row">
                      <button
                        type="button"
                        className="supervisor-period-row-main"
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
                      {!period.covered && (
                        <button
                          type="button"
                          className="ghost small supervisor-skip-btn"
                          disabled={supervisorImporting}
                          onClick={e => void skipPeriod(period, e)}
                        >
                          {tr('gallerySupervisor.skip')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {galleryFolders?.granted && galleryFolders.folders.length > 0 && (
              <div className="supervisor-section">
                <div className="supervisor-section-head">
                  <div className="supervisor-section-label">{tr('gallerySupervisor.folders')}</div>
                  <button type="button" className="ghost small" disabled={supervisorImporting || !uncoveredFolders.length} onClick={() => void bringAllFolders()}>
                    <GridIcon className="inline-icon" aria-hidden="true" /> {tr('gallerySupervisor.allFolders.cta')}
                  </button>
                </div>
                <div className="supervisor-period-list">
                  {galleryFolders.folders.map(folder => {
                    const covered = supervisorImportedFolderIds.has(folder.id);
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        className="supervisor-period-row"
                        disabled={supervisorImporting}
                        onClick={() => void bringFolder(folder)}
                      >
                        <span><FolderIcon className="inline-icon" aria-hidden="true" /> {folder.name}</span>
                        {covered && (
                          <span className="supervisor-period-covered">
                            <CheckIcon className="inline-icon" aria-hidden="true" /> {tr('gallerySupervisor.covered')}
                          </span>
                        )}
                        <span className="mono">{tr(plural(folder.count, 'gallerySupervisor.folderCount.one', 'gallerySupervisor.folderCount.other'), { count: folder.count })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
