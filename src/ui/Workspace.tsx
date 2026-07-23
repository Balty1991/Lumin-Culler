import { useEffect, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { Tooltip } from './Tooltip';
import { ChevronLeft, ChevronRight, XIcon, CheckIcon, InfoIcon, EyeClosedIcon, GridIcon, PlusIcon, MenuIcon, UndoIcon } from './icons';

/**
 * Spatiu de lucru profesional: lupa (imagine mare, centrata) + filmstrip
 * persistent dedesubt — alternativa la grid + DetailView modal, pentru
 * triaj rapid, tastatura-intai. Reutilizeaza detailId/stepDetail/setStatus
 * din store (acelasi "cursor" de navigare ca DetailView), nu duplica stare.
 * Cand e activ, App.tsx nu mai monteaza DetailView (ar fi un modal peste
 * un modal — aceeasi poza afisata de doua ori).
 */
export function Workspace() {
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const filtered = useStore(s => s.filtered());
  const progress = useStore(s => s.progress);
  const history = useStore(s => s.history);
  const undo = useStore(s => s.undo);
  const openDetail = useStore(s => s.openDetail);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const runImport = useStore(s => s.runImport);
  const [src, setSrc] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detailId) { setSrc(null); return; }
    let url: string | null = null;
    let alive = true;
    db.previews.get(detailId).then(async p => {
      const rec = p ?? (await db.thumbnails.get(detailId));
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [detailId]);

  // scroll automat, ca miniatura activa sa ramana vizibila in filmstrip
  useEffect(() => {
    const el = filmstripRef.current?.querySelector('.workspace-thumb.active');
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const id = detailIdRef.current;
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      else if ((e.key === 'p' || e.key === 'P') && id) { void setStatus(id, 'selected'); stepDetail(1); }
      else if ((e.key === 'x' || e.key === 'X') && id) { void setStatus(id, 'rejected'); stepDetail(1); }
      else if (e.key === 'i' || e.key === 'I') setShowMetrics(v => !v);
      else if (e.key === 'Escape') {
        // Paleta/scurtaturile au propriul listener global de Escape (tot pe
        // window) — stopPropagation() din ele NU opreste alti listeneri de pe
        // ACELASI target sa ruleze (doar propagarea intre elemente diferite),
        // asa ca verificam direct starea: daca un panou e deasupra, il lasam
        // pe el sa se inchida, nu iesim si din Workspace odata cu el.
        const { paletteOpen, shortcutsOpen } = useStore.getState();
        if (paletteOpen || shortcutsOpen) return;
        setWorkspaceMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepDetail, setStatus, setWorkspaceMode]);

  const onFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    void runImport(Array.from(list));
    if (fileRef.current) fileRef.current.value = '';
  };

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.ptx,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.raw,.rwl,.iiq,.x3f"
      multiple
      hidden
      onChange={e => onFiles(e.target.files)}
    />
  );

  if (!photo) {
    return (
      <div className="workspace">
        <header className="workspace-head">
          <span className="mono workspace-hint">Nicio poza de afisat in acest filtru.</span>
          {history.length > 0 && (
            <Tooltip label="Anuleaza ultima decizie" shortcut="Ctrl+Z">
              <button className="ghost icon-btn" onClick={() => void undo()} aria-label={`Anuleaza ultima decizie (${history.length} disponibile, Ctrl+Z)`}>
                <UndoIcon />
                <span className="undo-count mono">{history.length}</span>
              </button>
            </Tooltip>
          )}
          <Tooltip label="Vezi grila" side="left">
            <button className="ghost icon-btn" onClick={() => setWorkspaceMode(false)} aria-label="Vezi grila de poze">
              <GridIcon />
            </button>
          </Tooltip>
          <Tooltip label="Meniu" side="left">
            <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label="Meniu">
              <MenuIcon />
            </button>
          </Tooltip>
        </header>
        <p className="empty-filter">Nicio poza de afisat in acest filtru.</p>
        {fileInput}
      </div>
    );
  }

  return (
    <div className="workspace">
      <header className="workspace-head">
        <span className="mono">{photo.fileName}</span>
        <span className="mono workspace-hint">
          {progress
            ? (progress.phase === 'analiza' ? `Analiza AI ${progress.done}/${progress.total}…` : 'Se proceseaza…')
            : '← → navigheaza · P selecteaza · X respinge · I statistici · Esc iesire'}
        </span>
        {history.length > 0 && (
          <Tooltip label="Anuleaza ultima decizie" shortcut="Ctrl+Z">
            <button className="ghost icon-btn" onClick={() => void undo()} aria-label={`Anuleaza ultima decizie (${history.length} disponibile, Ctrl+Z)`}>
              <UndoIcon />
              <span className="undo-count mono">{history.length}</span>
            </button>
          </Tooltip>
        )}
        <Tooltip label="Adauga poze">
          <button className="ghost icon-btn" onClick={() => fileRef.current?.click()} aria-label="Adauga poze">
            <PlusIcon />
          </button>
        </Tooltip>
        <Tooltip label="Statistici pe imagine" shortcut="I">
          <button
            className={showMetrics ? 'ghost icon-btn active' : 'ghost icon-btn'}
            onClick={() => setShowMetrics(v => !v)}
            aria-label={showMetrics ? 'Ascunde statisticile pe imagine' : 'Arata statisticile pe imagine'}
            aria-pressed={showMetrics}
          >
            <InfoIcon />
          </button>
        </Tooltip>
        <Tooltip label="Vezi grila" side="left">
          <button className="ghost icon-btn" onClick={() => setWorkspaceMode(false)} aria-label="Vezi grila de poze">
            <GridIcon />
          </button>
        </Tooltip>
        <Tooltip label="Meniu" side="left">
          <button className="ghost icon-btn" onClick={() => setMenuOpen(true)} aria-label="Meniu">
            <MenuIcon />
          </button>
        </Tooltip>
      </header>

      <div className="workspace-loupe">
        <div className="grain-overlay" aria-hidden="true" />
        <button className="ghost icon-btn workspace-nav prev" onClick={() => stepDetail(-1)} aria-label="Fotografia anterioara">
          <ChevronLeft />
        </button>
        {src && <img key={detailId} src={src} alt={photo.fileName} />}
        <span className={`status-tag st-${photo.status} workspace-badge`}>
          {photo.status === 'selected' ? 'SELECTATA' : photo.status === 'rejected' ? 'RESPINSA' : 'DE VERIFICAT'}
        </span>
        {showMetrics && (
          <div className="workspace-metrics mono">
            <span>Scor <b>{photo.aiScore}</b></span>
            <span>Claritate <b>{photo.sharpness}</b></span>
            <span>Expunere <b>{photo.exposure}</b></span>
            {photo.faceCount > 0 && <span>Fete <b>{photo.faceCount}</b></span>}
            {photo.faceCount > 0 && (
              <span>Zâmbet <b>{Math.round((photo.faceCount > 1 ? photo.groupSmileRatio ?? photo.bestSmile : photo.bestSmile) * 100)}%</b></span>
            )}
            {photo.faceCount > 0 && (
              <span className={(photo.groupEyesOpenRatio ?? (photo.allEyesOpen ? 1 : 0)) < 1 ? 'warn' : undefined}>
                {photo.allEyesOpen && (photo.groupEyesOpenRatio ?? 1) >= 1 ? null : <EyeClosedIcon className="inline-icon" />}
                Ochi <b>{Math.round((photo.groupEyesOpenRatio ?? (photo.allEyesOpen ? 1 : 0)) * 100)}%</b>
              </span>
            )}
          </div>
        )}
        <button className="ghost icon-btn workspace-nav next" onClick={() => stepDetail(1)} aria-label="Fotografia urmatoare">
          <ChevronRight />
        </button>
      </div>

      <div className="workspace-dock">
        <div className="workspace-actions">
          <button className="reject" onClick={() => { void setStatus(photo.id, 'rejected'); stepDetail(1); }}>
            <XIcon className="inline-icon" /> Respinge (X)
          </button>
          <button className="select" onClick={() => { void setStatus(photo.id, 'selected'); stepDetail(1); }}>
            <CheckIcon className="inline-icon" /> Selecteaza (P)
          </button>
        </div>

        <div className="workspace-filmstrip" ref={filmstripRef}>
          {filtered.map(p => (
            <button
              key={p.id}
              className={`workspace-thumb${p.id === detailId ? ' active' : ''}${p.status === 'rejected' ? ' rejected' : ''}`}
              onClick={() => openDetail(p.id)}
              title={p.fileName}
            >
              <FilmstripThumb photoId={p.id} fileName={p.fileName} />
            </button>
          ))}
        </div>
      </div>
      {fileInput}
    </div>
  );
}

function FilmstripThumb({ photoId, fileName }: { photoId: string; fileName: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    db.thumbnails.get(photoId).then(t => {
      if (t && alive) { url = URL.createObjectURL(t.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <img src={src} alt={fileName} loading="lazy" /> : <span className="card-loading" />;
}
