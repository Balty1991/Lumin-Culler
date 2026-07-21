import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';

/** Vizualizare detaliata pe PREVIEW 2048px (nu miniatura) + zoom 100% pentru
    evaluarea corecta a claritatii. */
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
      <div className="detail-inner">
        <header className="detail-head">
          <span className="mono">{photo.fileName}</span>
          <span className={`status-tag st-${photo.status}`}>
            {photo.status === 'selected' ? 'SELECTATA' : photo.status === 'rejected' ? 'RESPINSA' : 'DE VERIFICAT'}
          </span>
          <button className="ghost" onClick={() => openDetail(null)}>Inchide</button>
        </header>

        <div
          className={zoomed ? 'detail-img zoomed' : 'detail-img'}
          onClick={() => setZoomed(z => !z)}
          title={zoomed ? 'Iesi din zoom' : 'Zoom 100%'}
        >
          {src && <img src={src} alt={photo.fileName} />}
          <span className="zoom-hint mono">{zoomed ? '100% — trage pentru a naviga' : 'atinge pentru 100% (Z)'}</span>
        </div>

        <div className="metric-strip mono">
          <span>SCOR <b>{photo.aiScore}</b></span>
          <span>CLARITATE <b>{photo.sharpness}</b></span>
          <span>EXPUNERE <b>{photo.exposure}</b></span>
          <span>FETE <b>{photo.faceCount || '—'}</b></span>
          {photo.faceCount > 0 && <span>ZAMBET <b>{Math.round(photo.bestSmile * 100)}%</b></span>}
          {photo.faceCount > 0 && <span className={photo.allEyesOpen ? '' : 'warn'}>
            {photo.allEyesOpen ? 'OCHI DESCHISI' : 'CLIPIRE!'}
          </span>}
          {photo.personNames.length > 0 && <span>★ <b>{photo.personNames.join(', ')}</b></span>}
        </div>

        {photo.groupId && (
          <button className="ghost" onClick={() => { openDetail(null); openCompare(photo.groupId!); }}>
            ≡ Compara toata seria
          </button>
        )}

        <div className="detail-actions">
          <button className="ghost" onClick={() => stepDetail(-1)}>←</button>
          <button className="reject" onClick={() => void setStatus(photo.id, 'rejected')}>Respinge (X)</button>
          <button className="select" onClick={() => void setStatus(photo.id, 'selected')}>Selecteaza (P)</button>
          <button className="ghost" onClick={() => stepDetail(1)}>→</button>
        </div>
      </div>
    </div>
  );
}
