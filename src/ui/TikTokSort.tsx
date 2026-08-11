import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore } from '../state/store';
import { selectSortQueue, countSeriesSiblings } from '../state/tiktokSort';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useModalFocusTrap } from './useModalFocusTrap';
import { CollectionPicker } from './CollectionPicker';
import { AdjustedImage } from './AdjustedImage';
import { XIcon, HeartIcon, UndoIcon, ChevronUpIcon, SparkleIcon } from './icons';
import { t, type Locale } from '../i18n';

const SWIPE_UP_COMMIT = 80; // px de tras in sus pentru a trece la poza urmatoare (fara sa decida nimic)

function formatCaptureDate(ts: number | undefined, locale: Locale): string | null {
  if (!ts) return null;
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  return new Date(ts).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * "Sortare stil TikTok" (plan modernizare) — flux alternativ, plin ecran,
 * peste coada de poze nedecise (pending/review): un gest vertical de treci
 * mai departe (fara sa decizi) + o coloana de actiuni la indemana degetului
 * mare (pastreaza/sterge/album/anuleaza). NU inlocuieste grila+DetailView
 * (ramane calea principala, cu control fin per-poza) — e o a doua cale,
 * pentru triaj rapid pe cantitati mari, unde gestul de swipe deja e familiar
 * din alte aplicatii.
 *
 * Reutilizeaza in intregime `setStatus`/`undo` din store (acelasi istoric de
 * anulare, acelasi feedback haptic, aceeasi invatare AI ca restul aplicatiei)
 * — singurul lucru nou aici e prezentarea, nu o logica de decizie paralela.
 */
export function TikTokSort() {
  const open = useStore(s => s.tiktokSortOpen);
  const setOpen = useStore(s => s.setTiktokSortOpen);
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  const setStatus = useStore(s => s.setStatus);
  const undo = useStore(s => s.undo);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [sessionDone, setSessionDone] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // Ecranul ramane montat intre deschideri (acelasi tipar ca TripsPanel/PersonsPanel
  // — vezi `if (!open) return null` mai jos), deci coada/progresul trebuie resetate
  // explicit la fiecare deschidere, altfel un utilizator care redeschide ecranul
  // dupa o sesiune anterioara ar vedea inca pozele "sarite" (fara decizie) ascunse.
  useEffect(() => {
    if (open) { setSkipped(new Set()); setSessionDone(0); }
  }, [open]);

  const queue = useMemo(() => selectSortQueue(photos), [photos]);
  const visible = useMemo(() => queue.filter(p => !skipped.has(p.id)), [queue, skipped]);
  const current = visible[0] ?? null;
  const totalThisSession = sessionDone + visible.length;

  const [src, setSrc] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const dragYRef = useRef(0);
  const startYRef = useRef(0);

  useEffect(() => {
    if (!current) { setSrc(null); return; }
    let alive = true;
    setSrc(null);
    void getCachedPreviewUrl(current.id).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doar id-ul conteaza, ca in DetailView (photo.id)
  }, [current?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const skip = () => { if (!current) return; setSkipped(prev => new Set(prev).add(current.id)); setSessionDone(d => d + 1); };
  const decide = (status: 'selected' | 'rejected') => {
    if (!current) return;
    void setStatus(current.id, status);
    setSessionDone(d => d + 1);
  };
  const doUndo = () => {
    void undo();
    // vezi comentariul de mai sus despre acelasi istoric — daca anularea chiar
    // priveste ultima decizie luata aici, poza revine automat in `queue`
    // (status-ul redevine pending/review); scadem contorul in mod optimist,
    // fara sa incercam sa verificam daca anularea a fost intr-adevar despre
    // ecranul asta (istoricul e global, aceeasi limitare exista si la Ctrl+Z).
    setSessionDone(d => Math.max(0, d - 1));
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    dragYRef.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = Math.min(0, e.clientY - startYRef.current); // doar in sus
    dragYRef.current = delta;
    setDragY(delta);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragYRef.current < -SWIPE_UP_COMMIT) skip();
    dragYRef.current = 0;
    setDragY(0);
  };

  const seriesCount = current ? countSeriesSiblings(photos, current) : 0;
  const captureDate = current ? formatCaptureDate(current.capturedAt, locale) : null;
  const album = current ? (collections.find(c => c.memberIds.includes(current.id))?.name ?? current.project) : undefined;

  return (
    <div className="tiktok-sort" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('tiktok.title')} tabIndex={-1}>
      <button className="tiktok-close" onClick={() => setOpen(false)} aria-label={tr('tiktok.close')}>
        <XIcon />
      </button>

      {!current && (
        <div className="tiktok-empty">
          <SparkleIcon />
          <h3>{tr('tiktok.empty.title')}</h3>
          <p>{tr('tiktok.empty.sub')}</p>
        </div>
      )}

      {current && (
        <>
          <div className="tiktok-progress" role="progressbar" aria-valuenow={sessionDone} aria-valuemin={0} aria-valuemax={totalThisSession}>
            <i style={{ width: totalThisSession > 0 ? `${(sessionDone / totalThisSession) * 100}%` : '0%' }} />
          </div>
          <div className="tiktok-up-hint"><ChevronUpIcon aria-hidden="true" /><span>{tr('tiktok.hint')}</span></div>

          <div
            className="tiktok-stage-wrap"
            style={{ transform: `translateY(${dragY}px)`, transition: draggingRef.current ? 'none' : 'transform 0.25s var(--ease)' }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {src && <AdjustedImage src={src} alt="" className="tiktok-stage" />}
          </div>
          <div className="tiktok-veil-top" aria-hidden="true" />
          <div className="tiktok-veil-bottom" aria-hidden="true" />

          <div className="tiktok-caption">
            {seriesCount > 1 && (
              <span className="tiktok-ai-chip">
                <SparkleIcon className="inline-icon" aria-hidden="true" /> {tr('tiktok.caption.series', { count: seriesCount })}
              </span>
            )}
            <span className="tiktok-caption-sub">
              {[captureDate, album].filter(Boolean).join(' · ')}
            </span>
          </div>
        </>
      )}

      {/* Anuleaza ramane disponibil si dupa ce coada s-a golit (ultima decizie
          luata chiar aici e adesea exact cea pe care utilizatorul vrea sa o
          revizuiasca) — nu doar cat timp mai exista o poza curenta de decis. */}
      <div className="tiktok-rail">
        {current && (
          <>
            <span className="tiktok-rail-item">
              <button className="tiktok-rail-btn keep" onClick={() => decide('selected')} aria-label={tr('tiktok.rail.keep')}>
                <HeartIcon />
              </button>
              <span className="tiktok-rail-label">{tr('tiktok.rail.keep')}</span>
            </span>
            <span className="tiktok-rail-item">
              <CollectionPicker photoIds={[current.id]} iconOnly triggerClassName="tiktok-rail-btn album" />
              <span className="tiktok-rail-label">{tr('tiktok.rail.album')}</span>
            </span>
            <span className="tiktok-rail-item">
              <button className="tiktok-rail-btn del" onClick={() => decide('rejected')} aria-label={tr('tiktok.rail.delete')}>
                <XIcon />
              </button>
              <span className="tiktok-rail-label">{tr('tiktok.rail.delete')}</span>
            </span>
          </>
        )}
        <button className="tiktok-rail-btn undo" onClick={doUndo} aria-label={tr('tiktok.rail.undo')}>
          <UndoIcon />
        </button>
      </div>
    </div>
  );
}
