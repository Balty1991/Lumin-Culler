import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { selectSortQueue, countSeriesSiblings } from '../state/tiktokSort';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { SELECT_THRESHOLD, REJECT_THRESHOLD } from '../core/importPipeline';
import { explainFactors } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { CollectionPicker } from './CollectionPicker';
import { AdjustedImage } from './AdjustedImage';
import { XIcon, HeartIcon, UndoIcon, ChevronUpIcon, SparkleIcon } from './icons';
import { t, type Locale } from '../i18n';

const SWIPE_COMMIT = 80; // px de tras (sus SAU jos) pentru a schimba pozitia in coada, fara sa decida nimic
/** Peste acest numar de poze in coada, punctele individuale de progres (un <i> per poza) ar
    deveni fire de par nefolositoare vizual — cade pe bara continua clasica, cu numarator text. */
const MAX_PROGRESS_DOTS = 60;

type AiRecommendation = 'select' | 'review' | 'reject';

function aiRecommendation(score: number): AiRecommendation {
  if (score >= SELECT_THRESHOLD) return 'select';
  if (score <= REJECT_THRESHOLD) return 'reject';
  return 'review';
}

/** Motivul scorului AI, pe scurt — reutilizeaza aceiasi factori (topFactors) deja calculati
    la import, nu o noua explicatie: doar primele 2, ca sa incapa pe caption-ul plin ecran. */
function topReasonsText(photo: PhotoView, locale: Locale): string | null {
  const factors = explainFactors(photo.aiFactors, locale).slice(0, 2).map(f => f.label);
  return factors.length ? factors.join(', ') : null;
}

function formatCaptureDate(ts: number | undefined, locale: Locale): string | null {
  if (!ts) return null;
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  return new Date(ts).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * "Sortare stil TikTok" (plan modernizare) — flux alternativ, plin ecran,
 * peste coada de poze nedecise (pending/review): gest vertical BIDIRECTIONAL
 * (sus = mai departe fara sa decizi, jos = inapoi la poza anterioara — bug
 * real raportat de utilizator: prima versiune permitea doar inainte) + o
 * coloana de actiuni la indemana degetului mare (pastreaza/sterge/album/
 * anuleaza). NU inlocuieste grila+DetailView (ramane calea principala, cu
 * control fin per-poza) — e o a doua cale, pentru triaj rapid pe cantitati
 * mari, unde gestul de swipe deja e familiar din alte aplicatii.
 *
 * Coada e "inghetata" (queueIds) la deschidere, ca ordinea sa ramana STABILA
 * cat timp navighezi inainte/inapoi — un index (nu un filtru live) tine
 * pozitia curenta, iar poza efectiva e cautata dupa id in `photos` (starea
 * ei — decisa sau nu — ramane mereu la zi, chiar daca ordinea nu se schimba).
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

  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  // Ecranul ramane montat intre deschideri (acelasi tipar ca TripsPanel/PersonsPanel
  // — vezi `if (!open) return null` mai jos), deci coada/pozitia trebuie resetate
  // explicit la fiecare deschidere, altfel un utilizator care redeschide ecranul
  // dupa o sesiune anterioara ar relua de unde a ramas ultima data, nu de la inceput.
  useEffect(() => {
    if (open) { setQueueIds(selectSortQueue(photos).map(p => p.id)); setIndex(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coada se "ingheata" DOAR la momentul deschiderii, nu trebuie sa se refaca la fiecare schimbare din `photos`
  }, [open]);

  const photosById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const current = photosById.get(queueIds[index]) ?? null;
  const total = queueIds.length;

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

  // O poza poate disparea complet din `photos` (stersa nativ — ex. Mod Zen
  // "sterge automat duplicatele") fara sa fi fost decisa AICI — fara acest
  // efect, ecranul ar ramane blocat pe o poza fantoma (current === null la
  // un index valid), fara nicio cale sa mearga mai departe.
  useEffect(() => {
    if (open && !current && index < total) setIndex(i => Math.min(i + 1, total));
  }, [open, current, index, total]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const goNext = () => setIndex(i => Math.min(i + 1, total));
  const goPrev = () => setIndex(i => Math.max(i - 1, 0));
  const decide = (status: 'selected' | 'rejected') => {
    if (!current) return;
    void setStatus(current.id, status);
    goNext();
  };
  const doUndo = () => {
    void undo();
    // Anularea (istoric global, acelasi ca Ctrl+Z) readuce poza la pending/
    // review — mutam si pozitia inapoi, ca utilizatorul sa o vada din nou
    // imediat, nu doar sa observe ca progresul a scazut fara nicio poza vizibila.
    goPrev();
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    dragYRef.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientY - startYRef.current; // ambele directii
    dragYRef.current = delta;
    setDragY(delta);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragYRef.current < -SWIPE_COMMIT) goNext();
    else if (dragYRef.current > SWIPE_COMMIT) goPrev();
    dragYRef.current = 0;
    setDragY(0);
  };

  const seriesCount = current ? countSeriesSiblings(photos, current) : 0;
  const captureDate = current ? formatCaptureDate(current.capturedAt, locale) : null;
  const album = current ? (collections.find(c => c.memberIds.includes(current.id))?.name ?? current.project) : undefined;
  const recommendation = current ? aiRecommendation(current.aiScore) : null;
  const reasonsText = current ? topReasonsText(current, locale) : null;

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
          {total <= MAX_PROGRESS_DOTS ? (
            <div className="tiktok-progress-dots" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={total}>
              {queueIds.map((id, i) => <i key={id} className={i < index ? 'done' : undefined} />)}
            </div>
          ) : (
            <div className="tiktok-progress" role="progressbar" aria-valuenow={index} aria-valuemin={0} aria-valuemax={total}>
              <i style={{ width: total > 0 ? `${(index / total) * 100}%` : '0%' }} />
            </div>
          )}
          <span className="tiktok-progress-count mono" aria-hidden="true">{index + 1}/{total}</span>
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
            <div className="tiktok-chip-row">
              {recommendation && (
                <span className={`tiktok-ai-chip rec-${recommendation}`}>
                  <SparkleIcon className="inline-icon" aria-hidden="true" />
                  {tr(`tiktok.ai.${recommendation}`)} · {current.aiScore}
                </span>
              )}
              {seriesCount > 1 && (
                <span className="tiktok-ai-chip">
                  {tr('tiktok.caption.series', { count: seriesCount })}
                </span>
              )}
            </div>
            {reasonsText && <span className="tiktok-caption-sub">{reasonsText}</span>}
            <span className="tiktok-caption-sub tiktok-caption-meta">
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
