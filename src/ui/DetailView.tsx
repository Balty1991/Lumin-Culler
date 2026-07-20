import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';

/** Vizualizare detaliata: imagine mare + metrici AI + decizii (invata motorul). */
export function DetailView() {
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const [src, setSrc] = useState<string | null>(null);

  const photo = photos.find(p => p.id === detailId) ?? null;

  useEffect(() => {
    if (!detailId) { setSrc(null); return; }
    let url: string | null = null;
    let alive = true;
    db.thumbnails.get(detailId).then(t => {
      if (t && alive) { url = URL.createObjectURL(t.blob); setSrc(url); }
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
      else if (e.key === 'Escape') openDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId, stepDetail, setStatus, openDetail]);

  if (!photo) return null;

  const metrics: [string, string][] = [
    ['Scor AI', String(photo.aiScore)],
    ['Context', photo.contextKey],
    ['Claritate', photo.sharpness + ' / 100'],
    ['Expunere', photo.exposure + ' / 100'],
    ['Fete', String(photo.faceCount)],
    ['Cunoscuti', photo.personNames.length ? photo.personNames.join(', ') : (photo.knownFaceCount > 0 ? String(photo.knownFaceCount) : '—')],
    ['Straini', photo.strangerCount ? String(photo.strangerCount) : '—'],
    ['Zambet max.', photo.faceCount ? Math.round(photo.bestSmile * 100) + '%' : '—'],
    ['Ochi deschisi', photo.faceCount ? (photo.allEyesOpen ? 'da' : 'NU — clipire detectata') : '—']
  ];

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) openDetail(null); }}>
      <div className="detail-inner">
        <header className="detail-head">
          <span className="mono">{photo.fileName}</span>
          <button className="ghost" onClick={() => openDetail(null)}>Inchide</button>
        </header>
        <div className="detail-img">{src && <img src={src} alt={photo.fileName} />}</div>
        <dl className="metrics">
          {metrics.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
          ))}
        </dl>
        <p className="hint">Decizia ta antreneaza motorul pentru contextul „{photo.contextKey}".</p>
        <div className="detail-actions">
          <button className="ghost" onClick={() => stepDetail(-1)}>← Inapoi</button>
          <button className="reject" onClick={() => void setStatus(photo.id, 'rejected')}>Respinge (X)</button>
          <button className="select" onClick={() => void setStatus(photo.id, 'selected')}>Selecteaza (P)</button>
          <button className="ghost" onClick={() => stepDetail(1)}>Inainte →</button>
        </div>
      </div>
    </div>
  );
}
