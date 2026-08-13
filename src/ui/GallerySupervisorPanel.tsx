import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { isPeriodAlreadyCovered, PERIOD_MONTH_OPTIONS, ALL_PERIOD_MONTHS, type GalleryPeriod, type PeriodMonths } from '../state/gallerySupervisor';
import { formatPeriod } from './GallerySupervisorBanner';
import { ClockIcon, XIcon, FolderIcon, CheckIcon } from './icons';
import { GalleryOverviewNote } from './GalleryOverviewNote';
import { t, plural } from '../i18n';

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** 0.5/12/ALL sunt cazuri speciale ("2 saptamani"/"1 an"/"toata perioada"), nu doar "N luni" — restul folosesc pluralul normal. */
function periodMonthsLabel(months: PeriodMonths, tr: Tr): string {
  if (months === 0.5) return tr('gallerySupervisor.months.half');
  if (months === 12) return tr('gallerySupervisor.months.year');
  if (months === ALL_PERIOD_MONTHS) return tr('gallerySupervisor.months.all');
  return tr(plural(months, 'gallerySupervisor.months.one', 'gallerySupervisor.months.other'), { count: months });
}

/**
 * Panoul "Supervizorului galeriei": aduci galeria telefonului in aplicatie pe
 * bucati — cronologic (perioade) sau pe foldere.
 *
 * Reorganizat dupa feedback direct ("prea incarcat, si texte si vizual"). Ce
 * s-a schimbat fata de prima versiune, si de ce:
 *
 * - O bara de acoperire sus. Panoul nu spunea NICAIERI unde te afli in
 *   galerie; acum vezi din prima cat ai adus si cat a ramas.
 * - Perioade si Foldere devin doua file, nu doua sectiuni stivuite. Inainte
 *   trebuia sa derulezi peste toata lista de perioade ca sa ajungi la foldere.
 * - Perioada URMATOARE nu se mai repeta in lista de dedesubt (aparea de doua
 *   ori, o data ca ecran principal si o data ca prim rand).
 * - Lungimea perioadei era un rand de 6 pastile care se rupea pe doua randuri;
 *   e acum un <select> nativ, o singura linie, cu eticheta proprie.
 * - "Sari peste" era pe FIECARE rand (5-6 butoane identice). A ramas doar pe
 *   cardul perioadei urmatoare — acolo si inseamna ce zice ("las-o, treci la
 *   urmatoarea"), pentru ca actiunea muta cursorul; pe un rand oarecare din
 *   mijlocul listei ar fi insemnat, de fapt, "marcheaza tot pana aici ca
 *   sortat", ceea ce eticheta nu spunea.
 */
export function GallerySupervisorPanel() {
  const open = useStore(s => s.supervisorPanelOpen);
  const setOpen = useStore(s => s.setSupervisorPanelOpen);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  const [tab, setTab] = useState<'periods' | 'folders'>('periods');

  const galleryDateRange = useStore(s => s.galleryDateRange);
  const loadGalleryDateRange = useStore(s => s.loadGalleryDateRange);
  const supervisorPeriodMonths = useStore(s => s.supervisorPeriodMonths);
  const setSupervisorPeriodMonths = useStore(s => s.setSupervisorPeriodMonths);
  const supervisorCoveredUntil = useStore(s => s.supervisorCoveredUntil);
  const nextPeriod = useStore(s => s.supervisorNextPeriod());
  const allPeriods = useStore(s => s.supervisorAllPeriods());
  const remainingPeriod = useStore(s => s.supervisorRemainingPeriod());
  const coveragePercent = useStore(s => s.supervisorCoveragePercent());
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

  /**
   * Bug raportat: dupa "Adu pozele" nu se intampla nimic VIZIBIL — panoul
   * ramanea deschis, iar singurul semn era ca butoanele deveneau gri.
   * Utilizatorul a trebuit sa inchida panoul cu X ca sa vada ca lucreaza ceva.
   * Progresul (bannerul "Se aduc pozele...", apoi bara de analiza) traieste pe
   * Acasa, deci inchidem panoul odata cu pornirea importului si il ducem exact
   * acolo unde se vede ce se intampla.
   */
  const startImport = async (run: () => Promise<void>) => {
    setOpen(false);
    await run();
  };

  const bringPeriod = async (period: GalleryPeriod) => {
    if (supervisorImporting) return;
    if (isPeriodAlreadyCovered(period, supervisorCoveredUntil)) {
      const ok = await askConfirm(tr('gallerySupervisor.alreadyCovered.confirm', { period: formatPeriod(period.start, period.end, locale) }));
      if (!ok) return;
    }
    await startImport(() => importGalleryPeriod(period));
  };

  const bringRemaining = async () => {
    if (!remainingPeriod || supervisorImporting) return;
    const ok = await askConfirm(tr('gallerySupervisor.remaining.confirm', { period: formatPeriod(remainingPeriod.start, remainingPeriod.end, locale) }));
    if (!ok) return;
    await startImport(() => importGalleryPeriod(remainingPeriod));
  };

  const skipNext = async () => {
    if (!nextPeriod || supervisorImporting) return;
    const ok = await askConfirm(tr('gallerySupervisor.skip.confirm', { period: formatPeriod(nextPeriod.start, nextPeriod.end, locale) }));
    if (!ok) return;
    skipGalleryPeriod(nextPeriod);
  };

  const uncoveredFolders = (galleryFolders?.folders ?? []).filter(f => !supervisorImportedFolderIds.has(f.id));

  const bringAllFolders = async () => {
    if (supervisorImporting || !uncoveredFolders.length) return;
    const total = uncoveredFolders.reduce((sum, f) => sum + f.count, 0);
    const ok = await askConfirm(tr('gallerySupervisor.allFolders.confirm', { count: total }));
    if (!ok) return;
    await startImport(() => importAllGalleryFolders());
  };

  const bringFolder = async (folder: { id: string; name: string; count: number }) => {
    if (supervisorImporting) return;
    if (supervisorImportedFolderIds.has(folder.id)) {
      const ok = await askConfirm(tr('gallerySupervisor.folderCovered.confirm', { name: folder.name }));
      if (!ok) return;
    }
    await startImport(() => importGalleryFolder(folder.id));
  };

  // Perioada urmatoare are deja cardul ei mare deasupra — nu o repetam si in lista.
  const restPeriods = allPeriods.filter(p => !nextPeriod || p.start !== nextPeriod.start);
  const hasFolders = Boolean(galleryFolders?.granted && galleryFolders.folders.length);

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
            {/* Unde te afli in galerie — panoul nu spunea asta nicaieri. */}
            <div className="supervisor-coverage">
              <div className="supervisor-coverage-head">
                <b>{tr('gallerySupervisor.coverage', { percent: coveragePercent })}</b>
                {remainingPeriod && (
                  <span>{formatPeriod(remainingPeriod.start, remainingPeriod.end, locale)}</span>
                )}
              </div>
              <div className="supervisor-coverage-bar" role="progressbar" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${coveragePercent}%` }} />
              </div>
              {/* "Cate poze ai pe telefon" — mutat aici de pe ecranul gol: raspunde
                  la intrebarea pusa chiar de bara de deasupra ("cat mai am de adus?"),
                  in loc sa fie o a treia actiune concurenta pe ecranul de start. */}
              <GalleryOverviewNote />
            </div>

            {lastSupervisorImportIds && lastSupervisorImportIds.length > 0 && (
              <button
                type="button"
                className="btn-accent supervisor-sortnow-cta"
                onClick={() => openTiktokSortForIds(lastSupervisorImportIds)}
              >
                {tr(plural(lastSupervisorImportIds.length, 'gallerySupervisor.sortNow.one', 'gallerySupervisor.sortNow.other'), { count: lastSupervisorImportIds.length })}
              </button>
            )}

            {hasFolders && (
              <div className="supervisor-tabs" role="tablist" aria-label={tr('gallerySupervisor.panelTitle')}>
                <button
                  type="button" role="tab" aria-selected={tab === 'periods'}
                  className={tab === 'periods' ? 'supervisor-tab active' : 'supervisor-tab'}
                  onClick={() => setTab('periods')}
                >
                  {tr('gallerySupervisor.tab.periods')}
                </button>
                <button
                  type="button" role="tab" aria-selected={tab === 'folders'}
                  className={tab === 'folders' ? 'supervisor-tab active' : 'supervisor-tab'}
                  onClick={() => setTab('folders')}
                >
                  {tr('gallerySupervisor.tab.folders')}
                </button>
              </div>
            )}

            {tab === 'periods' || !hasFolders ? (
              <>
                {nextPeriod && (
                  <div className="supervisor-next">
                    <div className="supervisor-next-label">{tr('gallerySupervisor.next')}</div>
                    <div className="supervisor-next-range">{formatPeriod(nextPeriod.start, nextPeriod.end, locale)}</div>
                    <div className="supervisor-next-actions">
                      <button
                        type="button" className="btn-accent"
                        disabled={supervisorImporting}
                        onClick={() => void bringPeriod(nextPeriod)}
                      >
                        {tr('gallerySupervisor.bring')}
                      </button>
                      <button type="button" className="ghost" disabled={supervisorImporting} onClick={() => void skipNext()}>
                        {tr('gallerySupervisor.skip')}
                      </button>
                    </div>
                  </div>
                )}

                <label className="supervisor-length">
                  <span>{tr('gallerySupervisor.periodLength')}</span>
                  <select
                    className="drawer-select mono"
                    value={supervisorPeriodMonths}
                    onChange={e => setSupervisorPeriodMonths(Number(e.target.value) as PeriodMonths)}
                  >
                    {PERIOD_MONTH_OPTIONS.map(months => (
                      <option key={months} value={months}>{periodMonthsLabel(months as PeriodMonths, tr)}</option>
                    ))}
                  </select>
                </label>

                {restPeriods.length > 0 && (
                  <div className="supervisor-section">
                    <div className="supervisor-section-label">{tr('gallerySupervisor.calendar')}</div>
                    <div className="supervisor-period-list">
                      {restPeriods.map(period => (
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

                {remainingPeriod && (
                  <button type="button" className="ghost supervisor-remaining-cta" disabled={supervisorImporting} onClick={() => void bringRemaining()}>
                    {tr('gallerySupervisor.remaining.cta', { period: formatPeriod(remainingPeriod.start, remainingPeriod.end, locale) })}
                  </button>
                )}
              </>
            ) : (
              <div className="supervisor-section">
                <div className="supervisor-period-list">
                  {galleryFolders?.folders.map(folder => {
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
                        <span className="mono supervisor-folder-count">{tr(plural(folder.count, 'gallerySupervisor.folderCount.one', 'gallerySupervisor.folderCount.other'), { count: folder.count })}</span>
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="ghost supervisor-remaining-cta" disabled={supervisorImporting || !uncoveredFolders.length} onClick={() => void bringAllFolders()}>
                  {tr('gallerySupervisor.allFolders.cta')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
