import { useEffect, useMemo, useRef, useState } from 'react';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, LayersIcon, SparkleIcon, GridIcon } from './icons';
import { t } from '../i18n';

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const;
/** Peste aceasta miscare (px), un pointerdown pe imagine e tratat ca "a tras", nu ca un tap simplu — suprima deschiderea la 100%. */
const PAN_DRAG_THRESHOLD_PX = 4;

/** Blob URL al preview-ului (fallback miniatura) unei poze — extras din CompareCard ca sa fie reutilizat si de vizualizarea de suprapunere. */
function usePreviewUrl(photoId: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    void getCachedPreviewUrl(photoId).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
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
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [sortBySharpness, setSortBySharpness] = useState(false);
  const [topN, setTopN] = useState(3);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [overlayMode, setOverlayMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Pan sincronizat (plan "cat mai pro" — completeaza zoom-ul deja sincronizat
   * de mai sus): la zoom > 1x, tragi de ORICE cadru si toate cardurile se
   * deplaseaza IDENTIC, ca sa inspectezi acelasi detaliu (ochi, expresie) in
   * toate cadrele simultan, nu doar centrul fix al imaginii. Impartit la
   * zoomLevel in transform ca o miscare de X pixeli pe ecran sa produca
   * mereu acelasi deplasament vizual, indiferent de nivelul de zoom curent.
   */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const justPannedRef = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = panDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > PAN_DRAG_THRESHOLD_PX) drag.moved = true;
      setPan({ x: drag.originX + dx, y: drag.originY + dy });
    };
    const onUp = () => {
      if (panDragRef.current?.moved) justPannedRef.current = true;
      panDragRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onPanPointerDown = (e: React.PointerEvent) => {
    if (zoomLevel === 1) return;
    e.preventDefault();
    panDragRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y, moved: false };
    setIsPanning(true);
  };

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
    setPan({ x: 0, y: 0 });
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
      <div className="detail-inner wide" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('compare.ariaLabel')} tabIndex={-1}>
        <header className="detail-head">
          <span><LayersIcon className="inline-icon" /> {tr('compare.title', { count: members.length })}</span>
          <button className="ghost icon-btn" onClick={() => openCompare(null)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>
        {members.length > 2 && (
          <div className="compare-toolbar">
            <button
              className={sortBySharpness ? 'chip active' : 'chip'}
              onClick={() => setSortBySharpness(v => !v)}
            >{tr('compare.sortBySharpness')}</button>
            <span className="compare-topn">
              {tr('compare.keepTop')}
              <input
                type="number"
                min={1}
                max={members.length - 1 || 1}
                value={clampedN}
                onChange={e => setTopN(Number(e.target.value))}
                aria-label={tr('compare.keepTop.ariaLabel')}
              />
              {tr('compare.keepTop.bySharpness')}
              <button className="select small-btn" onClick={keepTopN}>{tr('compare.apply')}</button>
            </span>
          </div>
        )}

        <div className="compare-toolbar">
          <span className="compare-zoom-sync mono">
            {tr('compare.zoomSync')}
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
            ><GridIcon className="inline-icon" /> {tr('compare.overlayToggle')}</button>
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
                  pan={pan}
                  isPanning={isPanning}
                  onPanPointerDown={onPanPointerDown}
                  onKeep={() => void keepOnlyInGroup(groupId, m.id)}
                  onReject={() => void setStatus(m.id, 'rejected')}
                  onZoom={() => {
                    if (justPannedRef.current) { justPannedRef.current = false; return; }
                    openCompare(null); openDetail(m.id);
                  }}
                />
              ))}
            </div>
          )}
        <p className="hint">{tr('compare.hint')}</p>
      </div>
    </div>
  );
}

function CompareCard({ photo, recommended, zoomLevel, pan, isPanning, onPanPointerDown, onKeep, onReject, onZoom }: {
  photo: PhotoView;
  recommended: boolean;
  zoomLevel: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  onPanPointerDown: (e: React.PointerEvent) => void;
  onKeep: () => void;
  onReject: () => void;
  onZoom: () => void;
}) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const src = usePreviewUrl(photo.id);

  const imgButtonClass = ['compare-img', zoomLevel !== 1 && 'zoomed', isPanning && 'panning'].filter(Boolean).join(' ');

  return (
    <div className={recommended ? `compare-card st-${photo.status} recommended` : `compare-card st-${photo.status}`}>
      <button
        className={imgButtonClass}
        onClick={onZoom}
        onPointerDown={onPanPointerDown}
        title={tr(zoomLevel !== 1 ? 'compare.card.panTitle' : 'compare.card.zoomTitle')}
      >
        {src && (
          <img
            src={src} alt={photo.fileName} loading="lazy" decoding="async"
            style={zoomLevel !== 1
              ? { transform: `scale(${zoomLevel}) translate(${pan.x / zoomLevel}px, ${pan.y / zoomLevel}px)`, transformOrigin: 'center' }
              : undefined}
          />
        )}
        {recommended && (
          <span className="compare-recommend-badge">
            <SparkleIcon className="inline-icon" /> {tr('compare.card.recommended')}
          </span>
        )}
      </button>
      <div className="compare-meta mono">
        <div className="compare-stat">
          <span>{tr('detail.stat.score')} <b>{photo.aiScore}</b></span>
          <span className="compare-bar"><span className="compare-bar-fill" style={{ width: `${Math.max(0, Math.min(100, photo.aiScore))}%` }} /></span>
        </div>
        <div className="compare-stat">
          <span>{tr('detail.stat.sharpness')} <b>{photo.sharpness}</b></span>
          <span className="compare-bar"><span className="compare-bar-fill" style={{ width: `${Math.max(0, Math.min(100, photo.sharpness))}%` }} /></span>
        </div>
        <span className="compare-eyes">{photo.faceCount > 0 ? (photo.allEyesOpen ? tr('compare.card.eyesOpen') : tr('compare.card.blink')) : '—'}</span>
      </div>
      <div className="compare-actions">
        <button className="reject small-btn" onClick={onReject}>{tr('compare.card.reject')}</button>
        <button className="select small-btn" onClick={onKeep}>{tr('compare.card.keepOnly')}</button>
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
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
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
          {tr('compare.overlay.frameA')}
          <select value={aId ?? ''} onChange={e => setAId(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.fileName}</option>)}
          </select>
        </label>
        <label>
          {tr('compare.overlay.frameB')}
          <select value={bId ?? ''} onChange={e => setBId(e.target.value)}>
            {members.map(m => <option key={m.id} value={m.id}>{m.fileName}</option>)}
          </select>
        </label>
        <button className={diffMode ? 'chip active' : 'chip'} onClick={() => setDiffMode(v => !v)}>
          {tr('compare.overlay.diffToggle')}
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
          {tr('compare.overlay.opacityB')}
          <input type="range" min={0} max={100} value={opacity} onChange={e => setOpacity(Number(e.target.value))} />
          <span>{opacity}%</span>
        </label>
      )}
    </div>
  );
}
