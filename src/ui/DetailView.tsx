import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { explainFactors } from '../core/learning/ContextEngine';
import { AnimatedNumber } from './AnimatedNumber';
import { vibrate } from './haptics';
import { XIcon, ChevronLeft, ChevronRight, LayersIcon, StarIcon, CheckIcon, EyeClosedIcon, SparkleIcon } from './icons';

const SWIPE_COMMIT = 96;       // px de tras pentru a declansa decizia
const SWIPE_TAP_TOLERANCE = 6; // sub asta e considerat click (zoom), nu swipe

function StatTile({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'stat-tile warn' : 'stat-tile'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
  const deg = Math.max(0, Math.min(360, Math.round((score / 100) * 360)));
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${deg}deg, var(--surface-3) 0)` }}>
      <span className="score-ring-inner" style={{ color }}><AnimatedNumber value={score} /></span>
    </div>
  );
}

/** Vizualizare detaliata pe PREVIEW 2048px (nu miniatura) + zoom 100% pentru
    evaluarea corecta a claritatii. Poza (subiectul principal) primeste o
    inaltime generoasa fixa; doar zona de informatii (statistici + motive +
    persoane) e derulabila daca nu incape, ca sa nu ajunga sa domine ecranul
    in fata fotografiei — butoanele de decizie raman mereu vizibile, in afara
    zonei derulabile. Trage imaginea stanga/dreapta pentru Respinge/Selecteaza
    (ca la aplicatiile moderne de triaj foto), cu feedback haptic pe Android;
    click simplu ramane zoom 100%, distinse prin toleranta de miscare
    (SWIPE_TAP_TOLERANCE). */
export function DetailView() {
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const [src, setSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);

  const photo = photos.find(p => p.id === detailId) ?? null;

  useEffect(() => {
    setZoomed(false);
    setDragX(0);
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

  const commitSwipe = (status: 'selected' | 'rejected') => {
    vibrate(status === 'selected' ? 14 : [12, 40, 12]);
    void setStatus(photo.id, status);
    setDragX(0);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoomed) return;
    draggingRef.current = true;
    movedRef.current = false;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > SWIPE_TAP_TOLERANCE) movedRef.current = true;
    setDragX(delta);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragX > SWIPE_COMMIT) commitSwipe('selected');
    else if (dragX < -SWIPE_COMMIT) commitSwipe('rejected');
    else setDragX(0);
  };
  const onImageClick = () => {
    if (movedRef.current) return; // a fost swipe, nu tap — nu comuta zoom-ul
    setZoomed(z => !z);
  };

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
          onClick={onImageClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title={zoomed ? 'Iesi din zoom' : 'Zoom 100% (Z) · trage stanga/dreapta pentru decizie'}
        >
          <div
            className="swipe-surface"
            style={zoomed ? undefined : {
              transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
              transition: draggingRef.current ? 'none' : 'transform 0.25s var(--ease)'
            }}
          >
            {src && <img src={src} alt={photo.fileName} />}
          </div>
          {!zoomed && dragX > 4 && (
            <div className="swipe-badge swipe-badge-select" style={{ opacity: Math.min(1, dragX / SWIPE_COMMIT) }}>
              <CheckIcon /> SELECTEAZA
            </div>
          )}
          {!zoomed && dragX < -4 && (
            <div className="swipe-badge swipe-badge-reject" style={{ opacity: Math.min(1, -dragX / SWIPE_COMMIT) }}>
              <XIcon /> RESPINGE
            </div>
          )}
          <span className="zoom-hint mono">{zoomed ? '100% — trage pentru a naviga' : 'atinge pentru 100% (Z)'}</span>
        </div>

        <div className="detail-scroll">
          <div className="stat-grid">
            <div className="stat-tile score-tile">
              <ScoreRing score={photo.aiScore} />
              <span className="stat-label">Scor AI</span>
            </div>
            <StatTile label="Claritate" value={photo.sharpness} />
            <StatTile label="Expunere" value={photo.exposure} />
            {photo.faceCount > 0 && <StatTile label="Fete" value={photo.faceCount} />}
            {photo.faceCount > 0 && (
              // grup (mai multe fete): procent care zambesc, nu doar cea mai buna fata —
              // altfel un singur zambet mare "ascunde" restul grupului serios/nemultumit
              <StatTile
                label={photo.faceCount > 1 ? 'Zâmbete' : 'Zambet'}
                value={`${Math.round((photo.faceCount > 1 ? photo.groupSmileRatio ?? photo.bestSmile : photo.bestSmile) * 100)}%`}
              />
            )}
            {photo.faceCount > 0 && (
              // grup: procent cu ochii deschisi (nu strict "toti sau niciunul") — problema
              // clasica la poze de grup e mereu cineva care clipeste
              <StatTile
                label={photo.faceCount > 1 ? 'Ochi (grup)' : (photo.allEyesOpen ? 'Ochi OK' : 'Clipire')}
                value={
                  photo.faceCount > 1
                    ? `${Math.round((photo.groupEyesOpenRatio ?? (photo.allEyesOpen ? 1 : 0)) * 100)}%`
                    : (photo.allEyesOpen ? <CheckIcon /> : <EyeClosedIcon />)
                }
                warn={photo.faceCount > 1 ? (photo.groupEyesOpenRatio ?? 1) < 1 : !photo.allEyesOpen}
              />
            )}
            {photo.faceCount > 0 && <StatTile label="Treimi" value={`${Math.round(photo.ruleOfThirds * 100)}%`} />}
            {photo.faceCount > 0 && <StatTile label="Cadraj" value={`${Math.round(photo.headroom * 100)}%`} />}
          </div>

          {photo.aiFactors.length > 0 && (
            <div className="factor-row">
              <span className="factor-row-label mono"><SparkleIcon className="inline-icon" /> De ce acest scor</span>
              <div className="factor-tags">
                {explainFactors(photo.aiFactors).map(f => (
                  <span key={f.label} className={f.positive ? 'factor-tag pos' : 'factor-tag neg'}>
                    {f.positive ? '+' : '−'} {f.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {photo.personNames.length > 0 && (
            <p className="detail-persons mono"><StarIcon className="inline-icon" /> {photo.personNames.join(', ')}</p>
          )}

          {photo.groupId && (
            <button className="ghost slim" onClick={() => { openDetail(null); openCompare(photo.groupId!); }}>
              <LayersIcon className="inline-icon" /> Compara toata seria
            </button>
          )}
        </div>

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
