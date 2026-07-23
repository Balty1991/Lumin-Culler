import { useEffect, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { ChevronLeft, ChevronRight, XIcon, CheckIcon } from './icons';

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
  const openDetail = useStore(s => s.openDetail);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const setWorkspaceMode = useStore(s => s.setWorkspaceMode);
  const [src, setSrc] = useState<string | null>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
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
      else if (e.key === 'Escape') setWorkspaceMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepDetail, setStatus, setWorkspaceMode]);

  if (!photo) {
    return (
      <div className="workspace">
        <p className="empty-filter">Nicio poza de afisat in acest filtru.</p>
      </div>
    );
  }

  return (
    <div className="workspace">
      <header className="workspace-head">
        <span className="mono">{photo.fileName}</span>
        <span className="mono workspace-hint">← → navigheaza · P selecteaza · X respinge · Esc iesire</span>
        <button className="ghost icon-btn" onClick={() => setWorkspaceMode(false)} aria-label="Inchide spatiul de lucru">
          <XIcon />
        </button>
      </header>

      <div className="workspace-loupe">
        <button className="ghost icon-btn workspace-nav prev" onClick={() => stepDetail(-1)} aria-label="Fotografia anterioara">
          <ChevronLeft />
        </button>
        {src && <img src={src} alt={photo.fileName} />}
        <span className={`status-tag st-${photo.status} workspace-badge`}>
          {photo.status === 'selected' ? 'SELECTATA' : photo.status === 'rejected' ? 'RESPINSA' : 'DE VERIFICAT'}
        </span>
        <button className="ghost icon-btn workspace-nav next" onClick={() => stepDetail(1)} aria-label="Fotografia urmatoare">
          <ChevronRight />
        </button>
      </div>

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
