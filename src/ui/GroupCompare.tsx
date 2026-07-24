import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, SparkleIcon, GridIcon } from './icons';

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const;

/** Blob URL al preview-ului (fallback miniatura) unei poze — extras din CompareCard ca sa fie reutilizat si de vizualizarea de suprapunere. */
function usePreviewUrl(photoId: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    setSrc(null);
    db.previews.get(photoId).then(async p => {
      const rec = p ?? (await db.thumbnails.get(photoId));
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src;
}

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
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [overlayMode, setOverlayMode] = useState(false);
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
    setZoomLevel(1);
    setOverlayMode(false);
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

        <div className="compare-toolbar">
          <span className="compare-zoom-sync mono">
            Zoom sincronizat
            {ZOOM_LEVELS.map(z => (
              <button
                key={z}
                className={zoomLevel === z ? 'chip active' : 'chip'}
                onClick={() => setZoomLevel(z)}
              >{z}x</button>
            ))}
          </span>
          {members.length > 1 && (
            <button
              className={overlayMode ? 'chip active' : 'chip'}
              onClick={() => setOverlayMode(v => !v)}
            ><GridIcon className="inline-icon" /> Suprapunere doua cadre</button>
          )}
        </div>

        {overlayMode
          ? <OverlayCompare members={members} defaultAId={recommendedId} />
          : (
            <div className="compare-grid">
              {members.map(m => (
                <CompareCard
                  key={m.id}
                  photo={m}
                  recommended={m.id === recommendedId}
                  zoomLevel={zoomLevel}
                  onKeep={() => void keepOnlyInGroup(groupId, m.id)}
                  onReject={() => void setStatus(m.id, 'rejected')}
                  onZoom={() => { openCompare(null); openDetail(m.id); }}
                />
              ))}
            </div>
          )}
        <p className="hint">„Pastreaza doar acesta" respinge automat restul seriei si antreneaza
        motorul cu alegerea ta. Atinge imaginea pentru zoom 100%. Zoom-ul sincronizat mareste
        toate cadrele in acelasi punct (centru), util pentru comparat detalii fine (ochi, expresii).</p>
      </div>
    </div>
  );
}

function CompareCard({ photo, recommended, zoomLevel, onKeep, onReject, onZoom }: {
  photo: PhotoView;
  recommended: boolean;
  zoomLevel: number;
  onKeep: () => void;
  onReject: () => void;
  onZoom: () => void;
}) {
  const src = usePreviewUrl(photo.id);

  return (
    <div className={recommended ? `compare-card st-${photo.status} recommended` : `compare-card st-${photo.status}`}>
      <button className="compare-img" onClick={onZoom} title="Deschide la 100%">
        {src && (
          <img
            src={src} alt={photo.fileName} loading="lazy" decoding="async"
            style={zoomLevel !== 1 ? { transform: `scale(${zoomLevel})`, transformOrigin: 'center' } : undefined}
          />
        )}
        {recommended && (
          <span className="compare-recommend-badge">
            <SparkleIcon className="inline-icon" /> Recomandat AI
          </span>
        )}
      </button>
      <div className="compare-meta mono">
        <div className="compare-stat">
          <span>Scor <b>{photo.aiScore}</b></span>
          <span className="compare-bar"><span className="compare-bar-fill" style={{ width: `${Math.max(0, Math.min(100, photo.aiScore))}%` }} /></span>
        </div>
        <div className="compare-stat">
          <span>Claritate <b>{photo.sharpness}</b></span>
          <span className="compare-bar"><span className="compare-bar-fill" style={{ width: `${Math.max(0, Math.min(100, photo.sharpness))}%` }} /></span>
        </div>
        <span className="compare-eyes">{photo.faceCount > 0 ? (photo.allEyesOpen ? 'ochi deschisi' : 'CLIPIRE') : '—'}</span>
      </div>
      <div className="compare-actions">
        <button className="reject small-btn" onClick={onReject}>Respinge</button>
        <button className="select small-btn" onClick={onKeep}>Pastreaza doar acesta</button>
      </div>
    </div>
  );
}

/**
 * Suprapunere imagini (plan 3.2.2): doua cadre din aceeasi serie, unul peste altul,
 * cu opacitatea celui de sus reglabila — util pentru a vedea rapid ce s-a miscat
 * intre doua cadre aproape identice (compozitie, subiect) fara sa navighezi
 * intre ele. Modul "diferenta" evidentiaza exact zonele care difera (restul
 * cadrului, identic intre poze, devine aproape negru).
 */
function OverlayCompare({ members, defaultAId }: { members: PhotoView[]; defaultAId: string | null }) {
  const [aId, setAId] = useState(defaultAId ?? members[0]?.id ?? null);
  const [bId, setBId] = useState(members.find(m => m.id !== (defaultAId ?? members[0]?.id))?.id ?? members[0]?.id ?? null);
  const [opacity, setOpacity] = useState(50);
  const [diffMode, setDiffMode] = useState(false);

  const aSrc = usePreviewUrl(aId ?? '');
  const bSrc = usePreviewUrl(bId ?? '');
  const aPhoto = members.find(m => m.id === aId);
  const bPhoto = members.find(m => m.id === bId);

  return (
    <div className="overlay-compare">
      <div className="overlay-pickers mono">
        <label>
          Cadrul A
          <select value={aId ?? ''} onChange={e => setAId(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.fileName}</option>)}
          </select>
        </label>
        <label>
          Cadrul B (deasupra)
          <select value={bId ?? ''} onChange={e => setBId(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.fileName}</option>)}
          </select>
        </label>
        <button className={diffMode ? 'chip active' : 'chip'} onClick={() => setDiffMode(v => !v)}>
          Evidentiaza diferentele
        </button>
      </div>

      <div className="overlay-stage">
        {aSrc && <img src={aSrc} alt={aPhoto?.fileName ?? 'A'} className="overlay-img overlay-img-a" />}
        {bSrc && (
          <img
            src={bSrc} alt={bPhoto?.fileName ?? 'B'}
            className="overlay-img overlay-img-b"
            style={{ opacity: opacity / 100, mixBlendMode: diffMode ? 'difference' : 'normal' }}
          />
        )}
      </div>

      {!diffMode && (
        <label className="overlay-opacity-row mono">
          Opacitate cadru B
          <input type="range" min={0} max={100} value={opacity} onChange={e => setOpacity(Number(e.target.value))} />
          <span>{opacity}%</span>
        </label>
      )}
    </div>
  );
}
