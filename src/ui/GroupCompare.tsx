import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, SparkleIcon } from './icons';

/** Compararea unei serii: cadrele similare unul langa altul, la preview 2048px.
    Alegi cadrul pastrat — restul seriei se respinge automat (si antreneaza AI-ul). */
export function GroupCompare() {
  const groupId = useStore(s => s.compareGroupId);
  const openCompare = useStore(s => s.openCompare);
  const openDetail = useStore(s => s.openDetail);
  const keepOnlyInGroup = useStore(s => s.keepOnlyInGroup);
  const keepManyInGroup = useStore(s => s.keepManyInGroup);
  const setStatus = useStore(s => s.setStatus);
  const groupOf = useStore(s => s.groupOf);
  const selectBestPhotoInGroup = useStore(s => s.selectBestPhotoInGroup);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [sortBySharpness, setSortBySharpness] = useState(false);
  const [topN, setTopN] = useState(3);
  const containerRef = useRef<HTMLDivElement>(null);

  const rawMembers = groupId ? groupOf(groupId) : [];
  // burst-uri de sport/wildlife pot avea zeci de cadre aproape identice —
  // sortarea dupa claritate ajuta sa gasesti rapid cele mai nete, in loc sa
  // le compari vizual pe toate pe rand
  const members = useMemo(
    () => (sortBySharpness ? [...rawMembers].sort((a, b) => b.sharpness - a.sharpness) : rawMembers),
    [rawMembers, sortBySharpness]
  );
  useModalFocusTrap(containerRef, !!groupId && members.length > 0);

  useEffect(() => {
    setRecommendedId(null);
    setTopN(Math.min(3, Math.max(1, rawMembers.length)));
    if (!groupId) return;
    let alive = true;
    void selectBestPhotoInGroup(groupId).then(id => { if (alive) setRecommendedId(id); });
    return () => { alive = false; };
  }, [groupId, selectBestPhotoInGroup, rawMembers.length]);

  if (!groupId || members.length === 0) return null;

  const clampedN = Math.min(Math.max(1, topN), members.length - 1 || 1);

  const keepTopN = () => {
    const bySharpness = [...rawMembers].sort((a, b) => b.sharpness - a.sharpness);
    void keepManyInGroup(groupId, bySharpness.slice(0, clampedN).map(m => m.id));
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) openCompare(null); }}>
      <div className="detail-inner wide" ref={containerRef} role="dialog" aria-modal="true" aria-label="Comparare serie" tabIndex={-1}>
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> Serie de {members.length} cadre similare — alege-l pe cel mai bun</span>
          <button className="ghost icon-btn" onClick={() => openCompare(null)} aria-label="Inchide">
            <XIcon />
          </button>
        </header>
        {members.length > 2 && (
          <div className="compare-toolbar">
            <button
              className={sortBySharpness ? 'chip active' : 'chip'}
              onClick={() => setSortBySharpness(v => !v)}
            >Sorteaza dupa claritate</button>
            <span className="compare-topn">
              Pastreaza primele
              <input
                type="number"
                min={1}
                max={members.length - 1 || 1}
                value={clampedN}
                onChange={e => setTopN(Number(e.target.value))}
                aria-label="Cate cadre sa pastrezi din serie"
              />
              (dupa claritate)
              <button className="select small-btn" onClick={keepTopN}>Aplica</button>
            </span>
          </div>
        )}
        <div className="compare-grid">
          {members.map(m => (
            <CompareCard
              key={m.id}
              photo={m}
              recommended={m.id === recommendedId}
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

function CompareCard({ photo, recommended, onKeep, onReject, onZoom }: {
  photo: PhotoView;
  recommended: boolean;
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
        <div className="grain-overlay" aria-hidden="true" />
        {src && <img src={src} alt={photo.fileName} loading="lazy" decoding="async" />}
        {recommended && (
          <span className="compare-recommend-badge">
            <SparkleIcon className="inline-icon" /> Recomandat AI
          </span>
        )}
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
