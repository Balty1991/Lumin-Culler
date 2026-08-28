import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, FolderIcon, UploadIcon, TagIcon } from './icons';
import { getDirectoryPicker } from '../core/export/directoryPicker';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
import { exportAllowanceWarning } from '../state/freeAllowance';
import { sumKnownSizeBytes, formatSize } from '../state/storageStats';
import { t, plural } from '../i18n';

/**
 * ui/ExportDestinations.tsx
 * "Trimite pozele păstrate" (mockup 20) — foaia care intreaba UNDE ajung
 * pozele selectate, in loc sa decida singura aplicatia.
 *
 * Mockup-ul listeaza "Google Photos" si "Google Drive" cu stare de conectare,
 * adica integrari OAuth per serviciu — marcate "🔴 integrare externa" chiar in
 * foaia de parcurs din prezentare. Aici sunt inlocuite cu destinatia care
 * ajunge la ELE FARA nicio cheie de API: foaia de partajare a sistemului, prin
 * care Android ofera exact aplicatiile instalate (Google Photos, Drive,
 * Fisiere, WhatsApp...). Utilizatorul primeste rezultatul din mockup — pozele
 * ajung in cloud-ul lui, dintr-un singur ecran — iar aplicatia nu cere si nu
 * stocheaza niciun token, ceea ce se potriveste si cu promisiunea "totul
 * ramane pe dispozitiv".
 *
 * A doua optiune (folder) apare doar unde exista chiar un selector de folder
 * (SAF pe Android nativ, File System Access API pe Chromium desktop) — vezi
 * getDirectoryPicker. Fara el, o linie "Folder pe dispozitiv" ar fi un buton
 * care nu poate face ce spune.
 */
export function ExportDestinations() {
  const open = useStore(s => s.exportDestinationsOpen);
  const setOpen = useStore(s => s.setExportDestinationsOpen);
  const exportSelection = useStore(s => s.exportSelection);
  const exportXMP = useStore(s => s.exportXMP);
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const photosUsed = useStore(s => s.photosUsedThisWindow);
  const premiumLocked = useStore(s => s.premiumLocked);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const exportProgress = useStore(s => s.exportProgress);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Sertarul ramane deschis cat timp exportProgress e activ (inelul de mai jos
  // il citeste), si se inchide singur cand exportul chiar s-a terminat — nu
  // mai inchidem instant la apasare, ca in versiunea dinainte, unde progresul
  // real nu avea unde sa fie aratat.
  const wasExportingRef = useRef(false);
  useEffect(() => {
    if (exportProgress) wasExportingRef.current = true;
    else if (wasExportingRef.current) { wasExportingRef.current = false; setOpen(false); }
  }, [exportProgress, setOpen]);

  if (!open) return null;

  const selected = photos.filter(p => p.status === 'selected');
  const selectedCount = selected.length;
  const hasFolderPicker = getDirectoryPicker() !== null;
  const allowance = exportAllowanceWarning(selectedCount, photosUsed, FREE_PHOTOS_PER_MONTH, premiumLocked);
  const send = (destination: 'folder' | 'apps') => { void exportSelection(destination); };

  if (exportProgress) {
    const percent = Math.round((exportProgress.done / exportProgress.total) * 100);
    return (
      <div className="detail" onClick={e => e.stopPropagation()}>
        <div className="detail-inner narrow export-dest" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('exportDest.title')} tabIndex={-1}>
          <header className="detail-head">
            <span>{tr('exportDest.title')}</span>
            {/* Ascunde sertarul, nu opreste exportul — care continua oricum in
                fundal (vezi state/store.ts), la fel cum "notice" se poate
                inchide fara sa anuleze operatia in curs. */}
            <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
              <XIcon />
            </button>
          </header>
          <div className="export-progress-ring" style={{ background: `conic-gradient(var(--accent) ${percent * 3.6}deg, var(--surface-3) 0)` }}>
            <span className="export-progress-ring-inner">
              <b>{percent}%</b>
              <span>{tr('exportDest.progress.label')}</span>
            </span>
          </div>
          <p className="export-dest-count mono">
            {tr(plural(selectedCount, 'exportDest.count.one', 'exportDest.count.other'), { count: selectedCount })}
            {' · '}{formatSize(sumKnownSizeBytes(selected))}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="detail-inner narrow export-dest" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('exportDest.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span>{tr('exportDest.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <p className="export-dest-count">
          {tr(plural(selectedCount, 'exportDest.count.one', 'exportDest.count.other'), { count: selectedCount })}
        </p>

        {/* Plafonul, spus cat timp omul inca poate alege altfel. Pana acum,
            mesajul despre plafon se atasa notificarii de DUPA export — sosea
            exact cand nu mai putea servi la nimic. Vezi exportAllowanceWarning:
            nu apare pentru cine mai are loc berechet, ca sa nu transforme
            fiecare export intr-o reclama. */}
        {allowance && (
          <p className="export-dest-allowance">
            {allowance.kind === 'exceeds'
              ? tr(plural(allowance.remaining, 'exportDest.allowance.exceeds.one', 'exportDest.allowance.exceeds.other'), { selected: selectedCount, remaining: allowance.remaining, limit: FREE_PHOTOS_PER_MONTH })
              : tr(plural(allowance.remaining - selectedCount, 'exportDest.allowance.tight.one', 'exportDest.allowance.tight.other'), { left: allowance.remaining - selectedCount, limit: FREE_PHOTOS_PER_MONTH })}{' '}
            <button className="session-outcome-link" onClick={() => { setOpen(false); setPremiumOpen(true); }}>
              {tr('exportDest.allowance.cta')}
            </button>
          </p>
        )}

        <button className="export-dest-row" onClick={() => send('apps')}>
          <span className="export-dest-icon" aria-hidden="true"><UploadIcon /></span>
          <span className="export-dest-text">
            <b>{tr('exportDest.apps.title')}</b>
            <span>{tr('exportDest.apps.sub')}</span>
          </span>
        </button>

        {hasFolderPicker && (
          <button className="export-dest-row" onClick={() => send('folder')}>
            <span className="export-dest-icon" aria-hidden="true"><FolderIcon /></span>
            <span className="export-dest-text">
              <b>{tr('exportDest.folder.title')}</b>
              <span>{tr('exportDest.folder.sub')}</span>
            </span>
          </button>
        )}

        {/* A treia destinatie: munca de triaj, nu pozele.
            Exportul XMP exista de mult si e testat, dar traia intr-o sectiune
            colapsata din meniu, sub eticheta "Etichete Lightroom (XMP)" — pe
            care o recunoaste doar cine stie deja ce e un sidecar. Aici, in
            ecranul in care tocmai ai terminat de ales si te intrebi unde pleaca
            rezultatul, e exact locul in care are sens: pentru un fotograf,
            "unde pleaca" nu inseamna intotdeauna fisiere copiate, ci decizia
            dusa mai departe in programul in care lucreaza. */}
        <button className="export-dest-row" onClick={() => { setOpen(false); void exportXMP(); }}>
          <span className="export-dest-icon" aria-hidden="true"><TagIcon /></span>
          <span className="export-dest-text">
            <b>{tr('exportDest.xmp.title')}</b>
            <span>{tr('exportDest.xmp.sub')}</span>
          </span>
        </button>

        <p className="export-dest-note">{tr('exportDest.note')}</p>
      </div>
    </div>
  );
}
