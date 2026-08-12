import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, FolderIcon, UploadIcon } from './icons';
import { getDirectoryPicker } from '../core/export/directoryPicker';
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
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const selectedCount = photos.filter(p => p.status === 'selected').length;
  const hasFolderPicker = getDirectoryPicker() !== null;
  const send = (destination: 'folder' | 'apps') => {
    setOpen(false);
    void exportSelection(destination);
  };

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

        <p className="export-dest-note">{tr('exportDest.note')}</p>
      </div>
    </div>
  );
}
