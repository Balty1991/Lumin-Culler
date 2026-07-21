import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';

/** Compararea unei serii: cadrele similare unul langa altul, la preview 2048px.
    Alegi cadrul pastrat — restul seriei se respinge automat (si antreneaza AI-ul). */
export function GroupCompare() {
  const groupId = useStore(s => s.compareGroupId);
  const openCompare = useStore(s => s.openCompare);
  const openDetail = useStore(s => s.openDetail);
  const keepOnlyInGroup = useStore(s => s.keepOnlyInGroup);
  const setStatus = useStore(s => s.setStatus);
  const groupOf = useStore(s => s.groupOf);

  const members = groupId ? groupOf(groupId) : [];

  if (!groupId || members.length === 0) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) openCompare(null); }}>
      <div className="detail-inner wide">
        <header className="detail-head">
          <span>Serie de {members.length} cadre similare — alege-l pe cel mai bun</span>
          <button className="ghost" onClick={() => openCompare(null)}>Inchide</button>
        </header>
        <div className="compare-grid">
          {members.map(m => (
            <CompareCard
              key={m.id}
              photo={m}
              onKeep={() => void keepOnlyInGroup(groupId, m.id)}
              onReject={() => void setStatus(m.id, 'rejected')}
              onZoom={() => { openCompare(null); openDetail(m.id); }}
            />
          ))}
        </div>
        <p className="hint">„Pastreaza doar acesta" respinge automat restul seriei si antreneaza
        motorul cu alegerea ta. Atinge imaginea pentru zoom 100%.</p>
      </div>
    </div>
  );
}

function CompareCard({ photo, onKeep, onReject, onZoom }: {
  photo: PhotoView;
  onKeep: () => void;
  onReject: () => void;
  onZoom: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    db.previews.get(photo.id).then(async p => {
      const rec = p ?? (await db.thumbnails.get(photo.id));
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id]);

  return (
    <div className={`compare-card st-${photo.status}`}>
      <button className="compare-img" onClick={onZoom} title="Deschide la 100%">
        {src && <img src={src} alt={photo.fileName} />}
      </button>
      <div className="compare-meta mono">
        <span>Scor <b>{photo.aiScore}</b></span>
        <span>Claritate <b>{photo.sharpness}</b></span>
        <span>{photo.faceCount > 0 ? (photo.allEyesOpen ? 'ochi deschisi' : 'CLIPIRE') : '—'}</span>
      </div>
      <div className="compare-actions">
        <button className="reject small-btn" onClick={onReject}>Respinge</button>
        <button className="select small-btn" onClick={onKeep}>Pastreaza doar acesta</button>
      </div>
    </div>
  );
}
