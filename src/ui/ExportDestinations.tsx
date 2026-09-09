import { useEffect, useRef, useState } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, FolderIcon, UploadIcon, TagIcon, CheckIcon, LockIcon, PrinterIcon } from './icons';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
import { exportAllowanceWarning } from '../state/freeAllowance';
import { sumKnownSizeBytes, formatSize } from '../state/storageStats';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { t, plural } from '../i18n';

/** Rand de fisier din "Fisiere selectate" (mockup "Lumin Culler PRO") — miniatura reala din cache, nu un placeholder. */
function ExportFileRow({ photo }: { photo: PhotoView }) {
  const [src, setSrc] = useState<string | null>(() => peekThumbUrl(photo.id));
  useEffect(() => {
    if (src) return;
    let alive = true;
    void getCachedThumbUrl(photo.id).then(url => { if (alive && url) setSrc(url); });
    return () => { alive = false; };
  }, [photo.id, src]);
  return (
    <li className="export-file-row">
      <span className="export-file-thumb" aria-hidden="true">{src && <img src={src} alt="" />}</span>
      <span className="export-file-name mono">{photo.fileName}</span>
      <span className="export-file-check" aria-hidden="true"><CheckIcon /></span>
    </li>
  );
}

/** Peste atat, lista devine un perete de miniaturi fara sa mai adauge informatie — un numar ajunge. */
const EXPORT_FILE_LIST_MAX = 8;

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
  const gatePremium = useStore(s => s.gatePremium);
  const setFilter = useStore(s => s.setFilter);
  const setContactSheetOpen = useStore(s => s.setContactSheetOpen);
  const exportProgress = useStore(s => s.exportProgress);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  /* Cele trei comutatoare din mockup — actiuni reale, nu decor:
     "Copiaza in folder" = exportSelection('folder') (cade singur pe
     descarcare daca platforma n-are selector de folder, vezi
     core/exportPhotos.ts), "Descarca individual" = exportSelection('apps')
     (foaia de partajare/descarcare a sistemului), "Lista JSON pentru
     Lightroom" = exportXMP() — cel mai apropiat echivalent real (sidecar-uri
     .xmp, nu JSON literal, dar acelasi rol: munca de triaj, nu pozele). */
  const [toFolder, setToFolder] = useState(true);
  const [individually, setIndividually] = useState(false);
  const [xmpList, setXmpList] = useState(true);

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
  /* Ce vede aici cineva care n-a triat inca nimic.
     "Export" e unul dintre cele patru taburi permanente, deci se deschide si
     inainte sa existe vreo selectie — si pana la runda asta arata trei
     comutatoare peste "0 poze" si un buton stins, fara sa spuna nicaieri de
     unde vine o selectie. Fundatura, la un tap distanta de ecranul principal.
     Etichetele Lightroom sunt exceptia care conteaza: ele se scriu pentru tot ce
     e DECIS (vezi exportXMP), deci un om care a respins 20 de poze si n-a
     pastrat niciuna are ce exporta chiar cu selectia goala. */
  const undecided = photos.filter(p => p.status === 'pending' || p.status === 'review');
  const decidedCount = photos.length - undecided.length;
  const allowance = exportAllowanceWarning(selectedCount, photosUsed, FREE_PHOTOS_PER_MONTH, premiumLocked);
  /** Sortarea rapida peste pozele nedecise — aceeasi coada ca butonul de pe ecranul principal. */
  const goSort = () => {
    setOpen(false);
    openTiktokSortForIds(undecided.slice().sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)).map(p => p.id));
  };
  const startExport = () => {
    // Poarta Premium, verificata INAINTE sa porneasca ceva.
    //
    // Pana aici, apasarea pornea toate exporturile bifate, iar exportXMP se
    // oprea singur in gatePremium si deschidea panoul de plata — peste un
    // export care rula deja. Omul vedea ecranul de abonament aparand peste o
    // bara de progres, fara sa inteleaga ce a fost blocat si ce nu.
    if (xmpList && gatePremium('xmp')) { setOpen(false); return; }
    if (xmpList) void exportXMP();
    if (toFolder) void exportSelection('folder');
    else if (individually) void exportSelection('apps');
    // Doar lista Lightroom bifata (fara Copiaza/Descarca): nimic de aratat in
    // inelul de progres, deci inchidem sertarul aici — exportXMP isi are
    // propriul semnal (notice), separat.
    else setOpen(false);
  };

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

        <p className="export-dest-count mono">
          {tr(plural(selectedCount, 'exportDest.count.one', 'exportDest.count.other'), { count: selectedCount })}
          {selectedCount > 0 && <>{' · '}{formatSize(sumKnownSizeBytes(selected))}</>}
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

        {/* Trei comutatoare, ca in mockup — fiecare o actiune reala (vezi
            startExport mai sus), nu o bifa decorativa. "Copiaza in folder"
            ramane bifat implicit chiar si fara selector de folder pe
            platforma curenta: exportSelection('folder') cade singur pe
            descarcare in acel caz (vezi core/exportPhotos.ts), deci
            comutatorul tot are efect real. */}
        {/* Fara nimic selectat SI fara nimic decis n-are ce face niciun
            comutator: foaia ramane doar cu explicatia si iesirea de mai jos. */}
        {(selectedCount > 0 || decidedCount > 0) && (
        <div className="export-toggle-list">
          <label className="export-toggle-row">
            <span className="export-toggle-icon" aria-hidden="true"><FolderIcon /></span>
            <span className="export-toggle-text">{tr('exportDest.toggle.folder')}</span>
            <input type="checkbox" className="export-toggle-switch" checked={toFolder} onChange={e => setToFolder(e.target.checked)} />
          </label>
          <label className="export-toggle-row">
            <span className="export-toggle-icon" aria-hidden="true"><UploadIcon /></span>
            <span className="export-toggle-text">{tr('exportDest.toggle.individually')}</span>
            <input type="checkbox" className="export-toggle-switch" checked={individually} onChange={e => setIndividually(e.target.checked)} />
          </label>
          <label className="export-toggle-row">
            <span className="export-toggle-icon export-toggle-icon-xmp" aria-hidden="true"><TagIcon /></span>
            <span className="export-toggle-text">
              {tr('exportDest.toggle.xmp')}
              {/* Eticheta spunea doar "Etichete Lightroom", sub un antet care
                  numara pozele SELECTATE — iar sidecar-urile se scriu pentru tot
                  ce e decis, si pastrate, si respinse (vezi exportXMP in
                  state/store.ts). Comportamentul e corect pentru Lightroom, unde
                  vrei respinsele marcate ca respinse; gresita era doar eticheta. */}
              <small className="export-toggle-sub">{tr('exportDest.toggle.xmp.scope')}</small>
            </span>
            {/* Lacatul, pe comutator. Fara el, singurul semn ca functia e
                platita era panoul de abonament aparut dupa apasare. */}
            {premiumLocked && (
              <span className="export-toggle-lock" title={tr('exportDest.toggle.xmp.locked')}>
                <LockIcon aria-hidden="true" /> {tr('exportDest.toggle.xmp.locked')}
              </span>
            )}
            <input type="checkbox" className="export-toggle-switch" checked={xmpList} onChange={e => setXmpList(e.target.checked)} />
          </label>
        </div>
        )}

        {selectedCount === 0 && (
          <div className="export-empty">
            <p>{tr(decidedCount > 0 ? 'exportDest.empty.decidedOnly' : 'exportDest.empty.lead')}</p>
            {undecided.length > 0 && (
              <button type="button" className="btn-accent big" onClick={goSort}>
                {tr(plural(undecided.length, 'exportDest.empty.cta.one', 'exportDest.empty.cta.other'), { count: undecided.length })}
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && (
          <>
            <p className="export-file-list-label">{tr('exportDest.fileList.label', { count: selectedCount })}</p>
            <ul className="export-file-list">
              {selected.slice(0, EXPORT_FILE_LIST_MAX).map(p => <ExportFileRow key={p.id} photo={p} />)}
            </ul>
            {selectedCount > EXPORT_FILE_LIST_MAX && (
              <p className="export-file-list-more">{tr('exportDest.fileList.more', { count: selectedCount - EXPORT_FILE_LIST_MAX })}</p>
            )}
          </>
        )}

        {/* Plansa de contact, LANGA SELECTIE.
            Traia doar in sertarul din Setari, in spatele a sase acordeoane
            inchise — adica singurul drum vizibil spre ea trecea prin ecranul de
            plata, unde i se cerea omului sa cumpere ceva ce nu vazuse niciodata
            functionand. Aici e la locul ei: ce faci cu selectia, langa celelalte
            lucruri pe care le faci cu selectia. Filtrul se pune pe "selectate",
            fiindca plansa arata ce e in grila. */}
        {selectedCount > 0 && (
          <button
            type="button" className="export-alt-action"
            onClick={() => { setOpen(false); setFilter('selected'); setContactSheetOpen(true); }}
          >
            <span className="export-alt-icon" aria-hidden="true"><PrinterIcon /></span>
            <span className="export-alt-text">
              <b>{tr('exportDest.contactSheet.title')}</b>
              <span>{tr('exportDest.contactSheet.sub', { count: selectedCount })}</span>
            </span>
            <span className="export-alt-go" aria-hidden="true">&rarr;</span>
          </button>
        )}

        {(selectedCount > 0 || decidedCount > 0) && (
          <>
        <p className="export-dest-note">{tr('exportDest.note')}</p>

        <button
          type="button" className="btn-accent big export-start-btn"
          /* Etichetele Lightroom nu au nevoie de selectie, ci de decizii: cu
             butonul stins pe selectedCount===0, un fotograf care tocmai a
             respins tot lotul nu putea sa-si scoata sidecar-urile. */
          disabled={
            (selectedCount === 0 || (!toFolder && !individually))
            && !(xmpList && decidedCount > 0)
          }
          onClick={startExport}
        >
          <UploadIcon className="inline-icon" aria-hidden="true" /> {tr('exportDest.start')}
        </button>
          </>
        )}
      </div>
    </div>
  );
}
