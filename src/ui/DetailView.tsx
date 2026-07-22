import { useEffect, useState, type ReactNode } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { AnimatedNumber } from './AnimatedNumber';
import { XIcon, ChevronLeft, ChevronRight, LayersIcon, StarIcon, CheckIcon, EyeClosedIcon } from './icons';

function StatTile({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'stat-tile warn' : 'stat-tile'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Vizualizare detaliata pe PREVIEW 2048px (nu miniatura) + zoom 100% pentru
    evaluarea corecta a claritatii. Layout in flex-coloana, calibrat sa incapa
    intr-un singur ecran (imaginea se micsoreaza, restul e fix) — nu ar trebui
    sa fie nevoie de scroll ca sa ajungi la butoanele de decizie. */
export function DetailView() {
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const [src, setSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const photo = photos.find(p => p.id === detailId) ?? null;

  useEffect(() => {
    setZoomed(false);
    if (!detailId) { setSrc(null); return; }
    let url: string | null = null;
    let alive = true;
    db.previews.get(detailId).then(async p => {
      const rec = p ?? (await db.thumbnails.get(detailId)); // fallback poze vechi
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [detailId]);

  useEffect(() => {
    if (!detailId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      else if (e.key === 'p' || e.key === 'P') void setStatus(detailId, 'selected');
      else if (e.key === 'x' || e.key === 'X') void setStatus(detailId, 'rejected');
      else if (e.key === 'z' || e.key === 'Z') setZoomed(z => !z);
      else if (e.key === 'Escape') openDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId, stepDetail, setStatus, openDetail]);

  if (!photo) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) openDetail(null); }}>
      <div className="detail-inner fit">
        <header className="detail-head">
          <span className="mono">{photo.fileName}</span>
          <span className={`status-tag st-${photo.status}`}>
            {photo.status === 'selected' ? 'SELECTATA' : photo.status === 'rejected' ? 'RESPINSA' : 'DE VERIFICAT'}
          </span>
          <button className="ghost icon-btn" onClick={() => openDetail(null)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>

        <div
          className={zoomed ? 'detail-img zoomed' : 'detail-img'}
          onClick={() => setZoomed(z => !z)}
          title={zoomed ? 'Iesi din zoom' : 'Zoom 100%'}
        >
          {src && <img src={src} alt={photo.fileName} />}
          <span className="zoom-hint mono">{zoomed ? '100% — trage pentru a naviga' : 'atinge pentru 100% (Z)'}</span>
        </div>

        <div className="stat-grid">
          <StatTile label="Scor AI" value={<AnimatedNumber value={photo.aiScore} />} />
          <StatTile label="Claritate" value={photo.sharpness} />
          <StatTile label="Expunere" value={photo.exposure} />
          {photo.faceCount > 0 && <StatTile label="Fete" value={photo.faceCount} />}
          {photo.faceCount > 0 && <StatTile label="Zambet" value={`${Math.round(photo.bestSmile * 100)}%`} />}
          {photo.faceCount > 0 && (
            <StatTile
              label={photo.allEyesOpen ? 'Ochi OK' : 'Clipire'}
              value={photo.allEyesOpen ? <CheckIcon /> : <EyeClosedIcon />}
              warn={!photo.allEyesOpen}
            />
          )}
        </div>

        {photo.personNames.length > 0 && (
          <p className="detail-persons mono"><StarIcon className="inline-icon" /> {photo.personNames.join(', ')}</p>
        )}

        {photo.groupId && (
          <button className="ghost slim" onClick={() => { openDetail(null); openCompare(photo.groupId!); }}>
            <LayersIcon className="inline-icon" /> Compara toata seria
          </button>
        )}

        <div className="detail-actions">
          <button className="ghost icon-btn" onClick={() => stepDetail(-1)} aria-label="Fotografia anterioara">
            <ChevronLeft />
          </button>
          <button className="reject" onClick={() => void setStatus(photo.id, 'rejected')}>Respinge (X)</button>
          <button className="select" onClick={() => void setStatus(photo.id, 'selected')}>Selecteaza (P)</button>
          <button className="ghost icon-btn" onClick={() => stepDetail(1)} aria-label="Fotografia urmatoare">
            <ChevronRight />
          </button>
        </div>
      </div>
    </div>
  );
}
