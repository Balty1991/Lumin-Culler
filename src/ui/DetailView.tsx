import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { db, type AnalysisRecord } from '../core/db';
import { useStore, type PhotoView } from '../state/store';
import { explainFactors } from '../core/learning/ContextEngine';
import { generateExplanation } from '../core/aiExplanationGenerator';
import { useModalFocusTrap } from './useModalFocusTrap';
import { StarRating } from './StarRating';
import { AnimatedNumber } from './AnimatedNumber';
import { vibrate } from './haptics';
import { XIcon, ChevronLeft, ChevronRight, LayersIcon, CheckIcon, EyeClosedIcon, SparkleIcon, ClockIcon, SunIcon } from './icons';

const SWIPE_COMMIT = 96;       // px de tras pentru a declansa decizia
const SWIPE_TAP_TOLERANCE = 6; // sub asta e considerat click (zoom), nu swipe
const EASE = [0.16, 1, 0.3, 1] as const;

type Tab = 'metrics' | 'why' | 'persons' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'metrics', label: 'Metrici' },
  { key: 'why', label: 'De ce acest scor' },
  { key: 'persons', label: 'Persoane' },
  { key: 'history', label: 'Istoric' }
];

function StatTile({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'stat-tile warn' : 'stat-tile'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

/** Linie compacta EXIF (ISO · diafragma · viteza · focala) — string gol daca nu exista deloc metadate. */
function formatExif(photo: { iso?: number; fNumber?: number; exposureTime?: number; focalLength?: number }): string {
  const parts: string[] = [];
  if (photo.iso !== undefined) parts.push(`ISO ${Math.round(photo.iso)}`);
  if (photo.fNumber !== undefined) parts.push(`f/${photo.fNumber.toFixed(photo.fNumber < 10 ? 1 : 0)}`);
  if (photo.exposureTime !== undefined && photo.exposureTime > 0) parts.push(formatShutter(photo.exposureTime));
  if (photo.focalLength !== undefined) parts.push(`${Math.round(photo.focalLength)}mm`);
  return parts.join(' · ');
}

/** Timp relativ scurt, in romana — suficient de precis pentru un istoric de minute/ore, nu o audiere legala. */
function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 5) return 'chiar acum';
  if (diffSec < 60) return `acum ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `acum ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `acum ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `acum ${diffD}z`;
}

// acelasi prag ca SELECT_THRESHOLD din core/importPipeline.ts (si train() din state/store.ts) —
// "ce ar recomanda AI-ul" pentru explicatia narativa de mai jos
const AI_SELECT_THRESHOLD = 65;

/** Explicatia narativa (paragrafe) pentru scorul AI — incarcata lenes (AnalysisRecord + ContextModelRecord
    complete nu fac parte din PhotoView), doar cat timp tab-ul "De ce acest scor" e deschis. */
function WhyExplanation({ photo }: { photo: PhotoView }) {
  const [paragraphs, setParagraphs] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    setParagraphs(null);
    void Promise.all([db.analyses.get(photo.id), db.contextModels.get(photo.contextKey)]).then(
      ([analysis, contextModel]) => {
        if (!alive || !analysis) return;
        const aiDecision = photo.aiScore >= AI_SELECT_THRESHOLD;
        const userDecision = photo.status === 'selected' ? true : photo.status === 'rejected' ? false : null;
        setParagraphs(generateExplanation(analysis as AnalysisRecord, aiDecision, userDecision, contextModel ?? null));
      }
    );
    return () => { alive = false; };
  }, [photo.id, photo.contextKey, photo.aiScore, photo.status]);

  if (paragraphs === null) return <p className="hint">Se genereaza explicatia…</p>;
  return (
    <div className="why-explanation">
      {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  selected: 'Selectata', rejected: 'Respinsa', review: 'De verificat', pending: 'In asteptare'
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
  const deg = Math.max(0, Math.min(360, Math.round((score / 100) * 360)));
  return (
    <div className="score-ring" style={{ background: `conic-gradient(${color} ${deg}deg, var(--surface-3) 0)` }}>
      <span className="score-ring-inner" style={{ color }}><AnimatedNumber value={score} /></span>
    </div>
  );
}

/**
 * Randat doar cat timp exista o poza (vezi DetailView mai jos) — separat intr-o
 * componenta proprie ca sa primeasca `photo` NEnulabil (evita null-checks peste
 * tot) fara sa strice animatia de iesire: DetailView pastreaza AnimatePresence
 * montat permanent, doar acest continut apare/dispare condiţionat, iar
 * navigarea intre poze (sageti) NU remonteaza componenta (fara `key={photo.id}`
 * — altfel fiecare Sageata ar re-juca intrarea, nu doar Escape/X).
 */
function DetailContent({ photo, reduceMotion }: { photo: PhotoView; reduceMotion: boolean }) {
  const history = useStore(s => s.history);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const setRating = useStore(s => s.setRating);
  const [src, setSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [tab, setTab] = useState<Tab>('metrics');
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // constant true: DetailContent monteaza o singura data cat timp panoul e deschis
  // (navigarea intre poze cu sagetile NU remonteaza, vezi comentariul de mai jos) —
  // capcana de focus trebuie sa se activeze o singura data la deschidere, nu la
  // fiecare schimbare de poza (altfel ar fura focusul vizibil la fiecare sageata)
  useModalFocusTrap(containerRef, true);

  const photoHistory = useMemo(
    () => history.filter(h => h.photoId === photo.id).slice().reverse(),
    [history, photo.id]
  );

  useEffect(() => {
    setZoomed(false);
    setDragX(0);
    setTab('metrics');
    let url: string | null = null;
    let alive = true;
    db.previews.get(photo.id).then(async p => {
      const rec = p ?? (await db.thumbnails.get(photo.id)); // fallback poze vechi
      if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); }
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignora tastarea in orice camp text (ex. cautarea din Paleta de comenzi) —
      // vezi acelasi gardian in Workspace.tsx
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      else if (e.key === 'p' || e.key === 'P') void setStatus(photo.id, 'selected');
      else if (e.key === 'x' || e.key === 'X') void setStatus(photo.id, 'rejected');
      else if (e.key === 'z' || e.key === 'Z') setZoomed(z => !z);
      else if (e.key >= '0' && e.key <= '5') void setRating(photo.id, photo.rating === Number(e.key) ? 0 : Number(e.key));
      else if (e.key === 'Escape') {
        // acelasi motiv ca in Workspace.tsx: stopPropagation() dintr-un alt
        // listener de pe window NU opreste acest listener sa ruleze (doar
        // propagarea intre elemente diferite) — verificam direct starea.
        const { paletteOpen, shortcutsOpen } = useStore.getState();
        if (paletteOpen || shortcutsOpen) return;
        openDetail(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo.id, photo.rating, stepDetail, setStatus, setRating, openDetail]);

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

  const exif = formatExif(photo);

  return (
    <motion.div
      className="detail detail-motion" onClick={e => { if (e.target === e.currentTarget) openDetail(null); }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
    >
      <motion.div
        className="detail-inner fit" ref={containerRef} role="dialog" aria-modal="true" aria-label={`Detalii: ${photo.fileName}`} tabIndex={-1}
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
        transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE }}
      >
        <header className="detail-head">
          <span className="mono">{photo.fileName}</span>
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
          <div className="grain-overlay" aria-hidden="true" />
          <div
            className="swipe-surface"
            style={zoomed ? undefined : {
              transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
              transition: draggingRef.current ? 'none' : 'transform 0.25s var(--ease)'
            }}
          >
            {src && <img src={src} alt={photo.fileName} />}
          </div>
          {!zoomed && <div className="detail-img-gradient" aria-hidden="true" />}
          <span className={`status-tag st-${photo.status} detail-badge`}>
            {photo.status === 'selected' ? 'SELECTATA' : photo.status === 'rejected' ? 'RESPINSA' : 'DE VERIFICAT'}
          </span>
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

        <div className="detail-rating-row">
          <StarRating rating={photo.rating} onRate={n => void setRating(photo.id, n)} />
        </div>

        {photo.groupId && (
          <button className="ghost slim" onClick={() => { openDetail(null); openCompare(photo.groupId!); }}>
            <LayersIcon className="inline-icon" /> Compara toata seria
          </button>
        )}

        <nav className="detail-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key} role="tab" aria-selected={tab === t.key}
              className={tab === t.key ? 'detail-tab active' : 'detail-tab'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'history' && photoHistory.length > 0 && <b className="detail-tab-count mono">{photoHistory.length}</b>}
            </button>
          ))}
        </nav>

        <div className="detail-scroll">
          {tab === 'metrics' && (
            <>
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
              {(photo.dominantColors?.length || photo.goldenHourDetected) && (
                <div className="color-palette-row">
                  {photo.goldenHourDetected && (
                    <span className="golden-badge lg" title="Ora de aur"><SunIcon /></span>
                  )}
                  {photo.dominantColors?.map(c => (
                    <span key={c} className="color-swatch" style={{ background: c }} title={c} />
                  ))}
                </div>
              )}
              {exif && <p className="detail-exif mono">{exif}</p>}
            </>
          )}

          {tab === 'why' && (
            photo.aiFactors.length > 0 ? (
              <>
                <WhyExplanation photo={photo} />
                <div className="factor-row">
                  <span className="factor-row-label mono"><SparkleIcon className="inline-icon" /> Factori pe scurt</span>
                  <div className="factor-tags">
                    {explainFactors(photo.aiFactors).map(f => (
                      <span key={f.label} className={f.positive ? 'factor-tag pos' : 'factor-tag neg'}>
                        {f.positive ? '+' : '−'} {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="hint">Inca nu exista explicatii de scor pentru aceasta poza.</p>
            )
          )}

          {tab === 'persons' && (
            photo.personNames.length > 0 ? (
              <ul className="detail-person-list">
                {photo.personNames.map(name => (
                  <li key={name}>
                    <span className="person-avatar">{name.charAt(0).toUpperCase()}</span>
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Nicio persoana cunoscuta recunoscuta in aceasta poza.</p>
            )
          )}

          {tab === 'history' && (
            photoHistory.length > 0 ? (
              <ul className="detail-history-list">
                {photoHistory.map((h, i) => (
                  <li key={h.ts + '-' + i}>
                    <span className="mono detail-history-time">{formatRelativeTime(h.ts)}</span>
                    <span>{STATUS_LABEL[h.previousStatus] ?? h.previousStatus} → <b>{STATUS_LABEL[h.newStatus] ?? h.newStatus}</b></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                <ClockIcon className="inline-icon" /> Nicio decizie manuala recenta pentru aceasta poza — istoricul pastreaza
                doar ultimele 10 schimbari din toata sesiunea, nu un jurnal complet.
              </p>
            )
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
      </motion.div>
    </motion.div>
  );
}

export function DetailView() {
  const detailId = useStore(s => s.detailId);
  const photos = useStore(s => s.photos);
  const reduceMotion = useReducedMotion();
  const photo = photos.find(p => p.id === detailId) ?? null;

  return (
    <AnimatePresence>
      {photo && <DetailContent photo={photo} reduceMotion={!!reduceMotion} />}
    </AnimatePresence>
  );
}
