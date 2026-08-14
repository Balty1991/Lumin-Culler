import { useEffect, useRef, useState } from 'react';
import { db } from '../core/db';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore } from '../state/store';
import { Tooltip } from './Tooltip';
import { StarRating } from './StarRating';
import { PhotoInfoTabs } from './PhotoInfoTabs';
import { EmptyFilterState } from './EmptyFilterState';
import { ChevronLeft, ChevronRight, ChevronUpIcon, XIcon, CheckIcon, GridIcon, PlusIcon, MenuIcon, EditIcon } from './icons';
import { UndoHistoryButton } from './UndoHistoryButton';
import { useHeaderBottomVar } from './useHeaderBottomVar';
import { AdjustedImage } from './AdjustedImage';
import type { EditAdjustments } from '../core/imageAdjust';
import { pickImportFiles } from '../core/filePicker';
import { armPickerWatchdog, type PickerWatchdog } from '../core/pickerWatchdog';
import { formatEta } from '../core/formatTime';
import { t } from '../i18n';

/**
 * Spatiu de lucru profesional: lupa (imagine mare, centrata) + filmstrip
 * persistent dedesubt — alternativa la grid + DetailView modal, pentru
 * triaj rapid, tastatura-intai. Reutilizeaza detailId/stepDetail/setStatus
 * din store (acelasi "cursor" de navigare ca DetailView), nu duplica stare.
 * Cand e activ, App.tsx nu mai monteaza DetailView (ar fi un modal peste
 * un modal — aceeasi poza afisata de doua ori).
 */
export function Workspace() {
  // Toastul se aseaza sub capul de ecran masurat — vezi useHeaderBottomVar.
  const headerBottomRef = useHeaderBottomVar<HTMLElement>();
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const filtered = useStore(s => s.filtered());
  const progress = useStore(s => s.progress);
  const cancelImport = useStore(s => s.cancelImport);
  const importCancelling = useStore(s => s.importCancelling);
  const openDetail = useStore(s => s.openDetail);
  const openEdit = useStore(s => s.openEdit);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const setRating = useStore(s => s.setRating);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const runImport = useStore(s => s.runImport);
  const setNotice = useStore(s => s.setNotice);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [src, setSrc] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickerWatchdogRef = useRef<PickerWatchdog | null>(null);
  // citit din listener-ul de tastatura (inregistrat o singura data, vezi mai
  // jos) — un ref, nu o dependenta de effect, ca sa nu reinregistram
  // listener-ul la fiecare navigare (detailId se schimba constant)
  const detailIdRef = useRef(detailId);
  detailIdRef.current = detailId;

  const photo = photos.find(p => p.id === detailId) ?? null;

  // la intrarea in workspace, daca nu exista inca un cursor valid, il punem
  // pe prima poza din filtrul activ — o singura data la montare (nu reactiv
  // pe `filtered`, care e un array NOU la fiecare update de store si ar
  // reinregistra efectul in bucla fara rost)
  useEffect(() => {
    const { detailId, filtered, openDetail } = useStore.getState();
    const list = filtered();
    if (list.length && (!detailId || !list.some(p => p.id === detailId))) openDetail(list[0].id);
  }, []);

  useEffect(() => {
    // Curatam src-ul VECHI inainte de fetch-ul nou (vezi acelasi fix in DetailView.tsx) —
    // bug real gasit de auditul QA: fara asta, o poza noua se putea afisa cu imaginea
    // fostei poze active pana la rezolvarea promisiunii.
    setSrc(null);
    if (!detailId) return;
    let alive = true;
    void getCachedPreviewUrl(detailId).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [detailId]);

  // scroll automat, ca miniatura activa sa ramana vizibila in filmstrip
  useEffect(() => {
    const el = filmstripRef.current?.querySelector('.workspace-thumb.active');
    // `typeof === 'function'`: scrollIntoView lipseste in jsdom (teste); e pur
    // cosmetic aici (banda se auto-centreaza), nu merita sa arunce.
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [detailId]);

  // inregistrat O SINGURA DATA (dependente stabile — actiunile Zustand nu-si
  // schimba niciodata referinta) — altfel un effect dependent de detailId
  // s-ar reinregistra la fiecare navigare, riscand ferestre scurte cu doi
  // listeneri activi simultan (o apasare misca cursorul de mai multe ori).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignora tastarea in orice camp text (ex. cautarea din Paleta de comenzi,
      // deschisa peste Workspace) — altfel litere ca "p"/"x" ar declansa
      // selecteaza/respinge in fundal in timp ce utilizatorul scrie o comanda
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Bug real gasit de auditul UI: scurtaturile de aici sunt definite ca taste
      // SIMPLE (P/X/I/0-5/Sageti), dar nu verificau deloc modificatorii — asa ca
      // fiecare combinatie de sistem care contine acele litere declansa in acelasi
      // timp si o DECIZIE ireversibila asupra pozei curente: Ctrl/Cmd+X (taie)
      // respingea poza si sarea mai departe, Ctrl/Cmd+P (tipareste) o selecta,
      // Ctrl/Cmd+1..5 (schimba fila in browser) ii schimba nota. Utilizatorul
      // vedea doar dialogul nativ al browserului, nu si ca in spatele lui poza a
      // fost deja mutata in alt teanc. Ctrl/Cmd+Z (Anuleaza, in App.tsx) si
      // Ctrl/Cmd+K (Paleta) au listenerii lor separati, care cer explicit
      // modificatorul, deci nu sunt afectate de acest filtru.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const id = detailIdRef.current;
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      else if ((e.key === 'p' || e.key === 'P') && id) { void setStatus(id, 'selected'); stepDetail(1); }
      else if ((e.key === 'x' || e.key === 'X') && id) { void setStatus(id, 'rejected'); stepDetail(1); }
      else if (e.key >= '0' && e.key <= '5' && id) {
        const n = Number(e.key);
        const current = useStore.getState().photos.find(p => p.id === id)?.rating ?? 0;
        void setRating(id, current === n ? 0 : n);
      }
      else if (e.key === 'i' || e.key === 'I') setShowMetrics(v => !v);
      else if (e.key === 'Escape') {
        // Paleta/scurtaturile au propriul listener global de Escape (tot pe
        // window) — stopPropagation() din ele NU opreste alti listeneri de pe
        // ACELASI target sa ruleze (doar propagarea intre elemente diferite),
        // asa ca verificam direct starea: daca ORICE panou/dialog e deasupra,
        // il lasam pe el sa se inchida, nu iesim si din Workspace odata cu el.
        // Bug real gasit de auditul QA: lipseau majoritatea panourilor din
        // aceasta lista, deci Escape inchidea Workspace pe sub un panou deschis
        // (ex. Persoane cunoscute) in loc sa-l inchida pe acela.
        const s = useStore.getState();
        if (
          s.paletteOpen || s.shortcutsOpen || s.menuOpen || s.personsOpen || s.insightsOpen ||
          s.batchOpsOpen || s.statsOpen || s.projectsOpen || s.contactSheetOpen || s.presentationOpen ||
          s.compareGroupId || s.editingPhotoId || s.dialogRequest
        ) return;
        setWorkspaceMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepDetail, setStatus, setRating, setWorkspaceMode]);

  const onFiles = (list: FileList | null) => {
    pickerWatchdogRef.current?.cancel();
    // Vezi acelasi comentariu in App.tsx: un FileList gol nu inseamna neaparat
    // ca utilizatorul n-a ales nimic — unele aplicatii sursa (Fisiere, Drive,
    // Descarcari) pot returna gol desi a apasat pe poze acolo.
    if (!list || !list.length) { setNotice(tr('app.import.noneSelected')); return; }
    void runImport(Array.from(list));
    if (fileRef.current) fileRef.current.value = '';
  };

  /** Vezi App.tsx onAddPhotosClick — acelasi tipar (File System Access API cu fallback la <input>), duplicat aici doar pentru ca Workspace are propriul buton "Adauga poze". */
  const onAddPhotosClick = async () => {
    const picked = await pickImportFiles();
    if (picked) {
      if (picked.files.length) void runImport(picked.files, picked.handles);
      return;
    }
    // vezi App.tsx onAddPhotosClick pentru bug-ul real pe care il evita cancel() aici
    pickerWatchdogRef.current?.cancel();
    pickerWatchdogRef.current = armPickerWatchdog(() => setNotice(tr('app.import.pickerTimeout')));
    fileRef.current?.click();
  };

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f"
      multiple
      hidden
      onChange={e => onFiles(e.target.files)}
    />
  );

  if (!photo) {
    return (
      <div className="workspace">
        <header className="workspace-head" ref={headerBottomRef}>
          <span className="mono workspace-hint">{tr('workspace.emptyHint')}</span>
          <UndoHistoryButton />
          <Tooltip label={tr('workspace.tooltip.grid')} side="left">
            <button className="ghost icon-btn" onClick={() => setWorkspaceMode(false)} aria-label={tr('workspace.grid.ariaLabel')}>
              <GridIcon />
            </button>
          </Tooltip>
          <Tooltip label={tr('app.tooltip.menu')} side="left">
            <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label={tr('app.menu.ariaLabel')}>
              <MenuIcon />
            </button>
          </Tooltip>
        </header>
        <EmptyFilterState />
        {fileInput}
      </div>
    );
  }

  return (
    <div className="workspace">
      <header className="workspace-head" ref={headerBottomRef}>
        {/* randul de iconite NU se mai infasoara linie cu linie (flex-wrap:nowrap
            aici, spre deosebire de .workspace-head care ramane wrap doar pentru
            butonul Anuleaza de mai jos) — numele fisierului se micsoreaza cu "…"
            cat e nevoie, iconitele raman fixe, mereu pe UN singur rand. Bug real
            raportat de utilizator: inainte, cu totul pe acelasi nivel de flex-wrap,
            iconitele se rupeau imprevizibil intre randuri (3+3, 4+2 etc, dupa cum
            se intampla sa incapa) in loc sa cedeze spatiu numelui fisierului. */}
        <div className="workspace-head-row">
          <span className="mono">{photo.fileName}</span>
          <span className="mono workspace-hint" role={progress ? 'status' : undefined} aria-live={progress ? 'polite' : undefined}>
            {progress
              ? (progress.phase === 'analiza'
                ? (progress.etaSeconds !== undefined
                  ? tr('workspace.progress.analyzingEta', { done: progress.done, total: progress.total, eta: formatEta(progress.etaSeconds) })
                  : tr('workspace.progress.analyzing', { done: progress.done, total: progress.total }))
                : tr('workspace.progress.processing'))
              : tr('workspace.defaultHint')}
          </span>
          <UndoHistoryButton />
          <Tooltip label={tr('app.addPhotos')}>
            {/* vezi App.tsx (acelasi buton, acelasi motiv) — evita al doilea import concurent */}
            <button className="ghost icon-btn" onClick={() => void onAddPhotosClick()} disabled={!!progress} aria-label={tr('app.addPhotos')}>
              <PlusIcon />
            </button>
          </Tooltip>
          {/* butonul (i) de aici a fost eliminat — duplica exact acelasi buton
              "METRICI" din dock (mai jos, mereu vizibil sub poza), care exista
              special ca sa rezolve o reclamatie de descoperibilitate anterioara
              (vezi comentariul .workspace-metrics-handle din styles.css); doar
              aglomera antetul fara sa adauge vreo functie noua. Comanda rapida
              "I" ramane neschimbata (leaga direct de showMetrics, nu de buton). */}
          <Tooltip label={tr('edit.open')} side="left">
            <button className="ghost icon-btn" onClick={() => openEdit(photo.id)} aria-label={tr('edit.open')}>
              <EditIcon />
            </button>
          </Tooltip>
          <Tooltip label={tr('workspace.tooltip.grid')} side="left">
            <button className="ghost icon-btn" onClick={() => setWorkspaceMode(false)} aria-label={tr('workspace.grid.ariaLabel')}>
              <GridIcon />
            </button>
          </Tooltip>
          <Tooltip label={tr('app.tooltip.menu')} side="left">
            <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label={tr('app.menu.ariaLabel')}>
              <MenuIcon />
            </button>
          </Tooltip>
        </div>
        {progress?.phase === 'analiza' && (
          // flex-basis:100% (.workspace-cancel-btn) — forteaza acest buton pe
          // PROPRIUL rand mereu, in loc sa concureze cu iconitele de navigare
          // (grila/meniu) pentru spatiu pe primul rand cand containerul da pe
          // afara. Bug real raportat: fara asta, iconitele treceau ele pe randul
          // 2 (mai putin vizibile/usor de gasit), desi butonul temporar de
          // anulare conta mai putin decat "iesirile" din Workspace.
          <button className="ghost small-btn workspace-cancel-btn" onClick={() => cancelImport()} disabled={importCancelling}>
            {importCancelling ? tr('app.progress.cancelling') : tr('app.progress.cancel')}
          </button>
        )}
      </header>

      <div className="workspace-loupe">
        <button className="ghost icon-btn workspace-nav prev" onClick={() => stepDetail(-1)} aria-label={tr('workspace.nav.prev')}>
          <ChevronLeft />
        </button>
        {src && <AdjustedImage key={detailId} src={src} edits={photo.edits} alt={photo.fileName} className="detail-stage-img" />}
        <span className={`status-tag st-${photo.status} workspace-badge`}>
          {photo.status === 'selected' ? tr('workspace.status.selected') : photo.status === 'rejected' ? tr('workspace.status.rejected') : tr('workspace.status.review')}
        </span>
        <div className="workspace-fab-row">
          <button className="detail-fab detail-fab-reject" onClick={() => { void setStatus(photo.id, 'rejected'); stepDetail(1); }} aria-label={tr('workspace.action.reject')}>
            <XIcon />
          </button>
          <button className="detail-fab detail-fab-select" onClick={() => { void setStatus(photo.id, 'selected'); stepDetail(1); }} aria-label={tr('workspace.action.select')}>
            <CheckIcon />
          </button>
        </div>
        <button className="ghost icon-btn workspace-nav next" onClick={() => stepDetail(1)} aria-label={tr('workspace.nav.next')}>
          <ChevronRight />
        </button>
      </div>

      <div className="workspace-dock">
        <button
          className={showMetrics ? 'workspace-metrics-handle expanded' : 'workspace-metrics-handle'}
          onClick={() => setShowMetrics(v => !v)}
          aria-expanded={showMetrics}
          aria-label={showMetrics ? tr('workspace.metrics.hide') : tr('workspace.metrics.show')}
        >
          <span className="workspace-metrics-handle-bar" aria-hidden="true" />
          <span className="workspace-metrics-peek-label mono">
            {tr('workspace.metrics.peekLabel')}
            <ChevronUpIcon aria-hidden="true" />
          </span>
        </button>
        {showMetrics && (
          <div className="workspace-metrics-panel">
            <PhotoInfoTabs photo={photo} src={src} />
          </div>
        )}

        {!showMetrics && (
          <>
            <div className="workspace-rating-row">
              <StarRating rating={photo.rating} onRate={n => void setRating(photo.id, n)} />
            </div>

            <div className="workspace-filmstrip" ref={filmstripRef}>
              {filtered.map(p => (
                <button
                  key={p.id}
                  className={`workspace-thumb${p.id === detailId ? ' active' : ''}${p.status === 'rejected' ? ' rejected' : ''}`}
                  onClick={() => openDetail(p.id)}
                  title={p.fileName}
                >
                  <FilmstripThumb photoId={p.id} fileName={p.fileName} lqip={p.lqip} edits={p.edits} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {fileInput}
    </div>
  );
}

function FilmstripThumb({ photoId, fileName, lqip, edits }: { photoId: string; fileName: string; lqip?: string; edits?: EditAdjustments }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    db.thumbnails.get(photoId).then(t => {
      if (t && alive) { url = URL.createObjectURL(t.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return (
    <span className="card-media">
      {lqip && <img className="card-lqip" src={lqip} alt="" />}
      {src && <AdjustedImage className="card-img-loaded" src={src} edits={edits} alt={fileName} loading="lazy" />}
      {!src && !lqip && <span className="card-loading" />}
    </span>
  );
}
