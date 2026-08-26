import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { selectSortQueue, selectScopedQueue, selectAllPhotosQueue, countSeriesSiblings } from '../state/tiktokSort';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { SELECT_THRESHOLD, REJECT_THRESHOLD } from '../core/importPipeline';
import { explainFactors } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { CollectionPicker } from './CollectionPicker';
import { AdjustedImage } from './AdjustedImage';
import { XIcon, HeartIcon, UndoIcon, ChevronUpIcon, SparkleIcon, LayersIcon, BookmarkIcon, BarChartIcon, CheckIcon } from './icons';
import { t, type Locale } from '../i18n';

const SWIPE_COMMIT = 80; // px de tras (sus SAU jos) pentru a schimba pozitia in coada, fara sa decida nimic
/** Peste acest numar de poze in coada, punctele individuale de progres (un <i> per poza) ar
    deveni fire de par nefolositoare vizual — cade pe bara continua clasica, cu numarator text. */
const MAX_PROGRESS_DOTS = 60;
/** Bug real raportat de utilizator: capturi de ecran/documente (aspect diferit de o poza
    normala) erau taiate de object-fit:cover, fara nicio cale sa vezi restul cadrului. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pointerMidpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type AiRecommendation = 'select' | 'review' | 'reject';

function aiRecommendation(score: number): AiRecommendation {
  if (score >= SELECT_THRESHOLD) return 'select';
  if (score <= REJECT_THRESHOLD) return 'reject';
  return 'review';
}

/**
 * Ce scrie pe pastila din coltul de jos: ce a hotarat OMUL, daca a hotarat
 * ceva, si abia altfel ce crede AI-ul.
 *
 * BUG RAPORTAT CU PATRU CAPTURI. Utilizatorul avea o serie de 3, a deschis-o
 * din coada si a apasat "Pastreaza doar acesta". keepOnlyInGroup chiar face ce
 * spune: cadrul ales devine 'selected', celelalte doua 'rejected', si in baza
 * de date, si in stare. Dar coada e inghetata la deschidere (vezi comentariul
 * lung din capul fisierului — ordinea trebuie sa ramana stabila ca sa poti
 * merge inapoi), deci cele doua respinse tot vin la rand.
 *
 * Iar cand veneau, pastila scria "Pastreaza · 74". Nu era o stare gresita in
 * date: `aiRecommendation` se calcula DOAR din scor si nu se uita niciodata la
 * `status`. Adica aplicatia ii recomanda calm sa pastreze exact poza pe care
 * tocmai o respinsese el, prin decizia lui, cu doua ecrane inainte.
 *
 * Decizia omului bate parerea masinii, peste tot si mereu. Scorul ramane pe
 * pastila — e informatie utila si cand te razgandesti.
 */
type CaptionVerdict =
  | { kind: 'mine'; status: 'selected' | 'rejected' | 'candidate' }
  | { kind: 'ai'; recommendation: AiRecommendation };

function captionVerdict(photo: PhotoView): CaptionVerdict {
  if (photo.status === 'selected' || photo.status === 'rejected' || photo.status === 'candidate') {
    return { kind: 'mine', status: photo.status };
  }
  return { kind: 'ai', recommendation: aiRecommendation(photo.aiScore) };
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
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const scopeIds = useStore(s => s.tiktokSortScopeIds);
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  const setStatus = useStore(s => s.setStatus);
  const setExplainPhotoId = useStore(s => s.setExplainPhotoId);
  const undo = useStore(s => s.undo);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open, true);

  // Ecranul ramane montat intre deschideri (acelasi tipar ca LocationsPanel/PersonsPanel
  // — vezi `if (!open) return null` mai jos), deci coada/pozitia trebuie resetate
  // explicit la fiecare deschidere, altfel un utilizator care redeschide ecranul
  // dupa o sesiune anterioara ar relua de unde a ramas ultima data, nu de la inceput.
  useEffect(() => {
    if (!open) return;
    // Cu scop (tiktokSortScopeIds, setat de openTiktokSortForIds): arata EXACT
    // pozele cerute, in ordinea primita — nu coada normala filtrata prin ele.
    // Vezi selectScopedQueue pentru bug-ul pe care il repara distinctia asta.
    const queue = scopeIds ? selectScopedQueue(photos, scopeIds) : selectSortQueue(photos);
    setQueueIds(queue.map(p => p.id));
    setIndex(0);
    setReviewingAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coada se "ingheata" DOAR la momentul deschiderii, nu trebuie sa se refaca la fiecare schimbare din `photos`
  }, [open]);

  /**
   * Coada a fost largita la TOATA biblioteca (vezi butonul "Vezi toate").
   * Cerinta directa: cu 77 de poze si 22 nedecise, tab-ul "Revizuiesc" arata
   * doar cele 22 — dar uneori vrei sa treci prin toate, ca sa verifici ce a
   * decis motorul singur.
   */
  const [reviewingAll, setReviewingAll] = useState(false);
  const reviewAll = () => {
    setQueueIds(selectAllPhotosQueue(photos).map(p => p.id));
    setIndex(0);
    setReviewingAll(true);
  };

  const photosById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const current = photosById.get(queueIds[index]) ?? null;
  const total = queueIds.length;

  const [src, setSrc] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragYRef = useRef(0);
  const startYRef = useRef(0);

  // Zoom/pan cu 2 degete (plan modernizare, cerinta directa a utilizatorului) —
  // vezi onStageDown/onStageMove/onStageUp mai jos pentru masina de stari completa
  // (navigare cu un deget la scala 1x, panoramare cu un deget la scala >1x, zoom
  // cu 2 degete oricand). zoomScale/zoomPan sunt STARE (pentru randare); *Ref sunt
  // sursa de adevar in timpul gestului (citite/scrise sincron in handlere, la fel
  // ca dragYRef de mai sus — fara ele, evenimente pointermove dese ar citi valori
  // "inghetate" din closure-ul din randarea anterioara).
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPan, setZoomPan] = useState({ x: 0, y: 0 });
  const zoomScaleRef = useRef(1);
  const zoomPanRef = useRef({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startScale: number; startPan: { x: number; y: number }; startMid: { x: number; y: number } } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);
  const zoomGestureActiveRef = useRef(false);
  /** true daca ultimul gest a MISCAT ceva (pan/zoom/swipe) — un tap simplu (fara miscare) pe imagine, cat timp e marita, reseteaza zoom-ul; un tap dupa ce chiar ai panoramat/miscat NU trebuie sa reseteze accidental. */
  const gestureMovedRef = useRef(false);

  // Fiecare poza noua incepe nemarita — zoom-ul NU se pastreaza intre poze (ar fi
  // surprinzator sa gasesti urmatoarea poza deja marita 3x din swipe-ul anterior).
  useEffect(() => {
    zoomScaleRef.current = 1;
    zoomPanRef.current = { x: 0, y: 0 };
    setZoomScale(1);
    setZoomPan({ x: 0, y: 0 });
  }, [current?.id]);

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
    const onKey = (e: KeyboardEvent) => {
      // Escape inchide fereastra de DEASUPRA, nu ecranul de dedesubt. Cand e
      // deschisa compararea seriei sau foaia de metrici, apasarea inchidea si
      // panoul, si coada de triaj — adica exact ce reclamase utilizatorul:
      // "o deschide, dar imi inchide sortarea rapida". Panourile isi au propriul
      // Escape; aici doar ne dam la o parte cat timp e ceva peste noi.
      if (e.key !== 'Escape') return;
      const st = useStore.getState();
      if (st.compareGroupId || st.detailId || st.editingPhotoId) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Trecerea la alta poza trebuie sa se VADA. Raportat direct la testare:
  // "uneori nici nu iti dai seama ca a trecut la alta imagine" — la doua poze
  // din aceeasi serie, facute la o secunda distanta, ecranul arata practic
  // identic inainte si dupa swipe, iar singurul indiciu era un contor mic.
  //
  // Cadrul nou intra din directia in care ai tras: inainte = de jos, inapoi =
  // de sus. Animatia se face din JS, nu dintr-o clasa CSS, ca sa se poata
  // REPETA la fiecare schimbare fara sa remontam imaginea (o remontare ar da un
  // cadru gol cat se incarca noul blob).
  const prevIndexRef = useRef(index);
  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = index;
    if (prev === index) return;
    const el = stageWrapRef.current;
    if (!el) return;
    // Cine a cerut mai putina miscare o primeste: fara animatie, dar cu acelasi
    // rezultat functional.
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fromBelow = index > prev;
    el.animate?.(
      [
        { transform: `translateY(${fromBelow ? 6 : -6}%)`, opacity: 0.35 },
        { transform: 'translateY(0)', opacity: 1 }
      ],
      { duration: 260, easing: 'cubic-bezier(.22,.61,.36,1)' }
    );
  }, [index]);


  if (!open) return null;

  const goNext = () => setIndex(i => Math.min(i + 1, total));
  const goPrev = () => setIndex(i => Math.max(i - 1, 0));
  const decide = (status: 'selected' | 'rejected' | 'candidate') => {
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

  /**
   * Un singur handler pentru toate gesturile pe imagine — PointerEvent nu are un
   * echivalent al `TouchEvent.touches` (lista tuturor degetelor active deodata),
   * asa ca tinem propria evidenta (pointersRef) si decidem ce inseamna gestul
   * curent dupa CATE degete sunt jos ACUM:
   *   - 2 degete -> pinch (zoom + panoramare dupa mijlocul intre degete)
   *   - 1 deget, deja marit (zoomScale > 1) -> panoramare
   *   - 1 deget, la 1x -> navigare verticala (comportamentul original)
   */
  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMovedRef.current = false;

    if (pointersRef.current.size === 2) {
      // Al doilea deget soseste in timp ce navigarea cu un deget era deja pornita —
      // anulam acea navigare (un pinch nu trebuie sa schimbe si poza curenta).
      draggingRef.current = false;
      dragYRef.current = 0;
      setDragY(0);
      panDragRef.current = null;
      const [p1, p2] = [...pointersRef.current.values()];
      zoomGestureActiveRef.current = true;
      pinchRef.current = {
        startDistance: pointerDistance(p1, p2),
        startScale: zoomScaleRef.current,
        startPan: zoomPanRef.current,
        startMid: pointerMidpoint(p1, p2)
      };
    } else if (pointersRef.current.size === 1) {
      if (zoomScaleRef.current > 1) {
        zoomGestureActiveRef.current = true;
        panDragRef.current = { startX: e.clientX, startY: e.clientY, startPan: zoomPanRef.current };
      } else {
        draggingRef.current = true;
        startYRef.current = e.clientY;
        dragYRef.current = 0;
      }
    }
  };

  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchRef.current) {
      gestureMovedRef.current = true;
      const [p1, p2] = [...pointersRef.current.values()];
      const ratio = pointerDistance(p1, p2) / pinchRef.current.startDistance;
      const nextScale = clamp(pinchRef.current.startScale * ratio, MIN_ZOOM, MAX_ZOOM);
      const newMid = pointerMidpoint(p1, p2);
      const nextPan = {
        x: pinchRef.current.startPan.x + (newMid.x - pinchRef.current.startMid.x),
        y: pinchRef.current.startPan.y + (newMid.y - pinchRef.current.startMid.y)
      };
      zoomScaleRef.current = nextScale;
      zoomPanRef.current = nextPan;
      setZoomScale(nextScale);
      setZoomPan(nextPan);
      return;
    }

    if (panDragRef.current) {
      gestureMovedRef.current = true;
      const drag = panDragRef.current;
      const nextPan = { x: drag.startPan.x + (e.clientX - drag.startX), y: drag.startPan.y + (e.clientY - drag.startY) };
      zoomPanRef.current = nextPan;
      setZoomPan(nextPan);
      return;
    }

    if (draggingRef.current) {
      const delta = e.clientY - startYRef.current; // ambele directii
      if (Math.abs(delta) > 4) gestureMovedRef.current = true;
      dragYRef.current = delta;
      setDragY(delta);
    }
  };

  const onStageUp = (e: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size >= 1) {
      // A ramas macar un deget dupa un pinch cu 2 — re-ancoram panoramarea la
      // pozitia lui curenta, ca imaginea sa nu "sara" cand pinch-ul se transforma
      // in panoramare cu un singur deget.
      pinchRef.current = null;
      if (zoomScaleRef.current > 1) {
        const [remaining] = [...pointersRef.current.values()];
        panDragRef.current = { startX: remaining.x, startY: remaining.y, startPan: zoomPanRef.current };
      }
      return;
    }

    // S-au ridicat toate degetele.
    pinchRef.current = null;
    panDragRef.current = null;
    zoomGestureActiveRef.current = false;
    if (draggingRef.current) {
      draggingRef.current = false;
      if (dragYRef.current < -SWIPE_COMMIT) goNext();
      else if (dragYRef.current > SWIPE_COMMIT) goPrev();
      dragYRef.current = 0;
      setDragY(0);
    }
  };

  /** Tap simplu (fara nicio miscare) cat timp imaginea e marita — revine la 1x, cel mai rapid mod de a "reseta" fara sa cauti un buton dedicat. */
  const onStageClick = () => {
    if (gestureMovedRef.current) { gestureMovedRef.current = false; return; }
    if (zoomScaleRef.current > 1) {
      zoomScaleRef.current = 1;
      zoomPanRef.current = { x: 0, y: 0 };
      setZoomScale(1);
      setZoomPan({ x: 0, y: 0 });
    }
  };

  const seriesCount = current ? countSeriesSiblings(photos, current) : 0;
  const captureDate = current ? formatCaptureDate(current.capturedAt, locale) : null;
  const album = current ? (collections.find(c => c.memberIds.includes(current.id))?.name ?? current.project) : undefined;
  const verdict = current ? captionVerdict(current) : null;
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
          {!reviewingAll && photos.length > 0 && (
            <button type="button" className="tiktok-review-all" onClick={reviewAll}>
              {tr('tiktok.reviewAll', { count: photos.length })}
            </button>
          )}
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
          {/* Trecerea la toata biblioteca, fara sa iesi din ecran. Apare doar cat
              timp coada e cea scurta (nedecise) si chiar exista mai multe poze
              decat atat — altfel butonul n-ar duce nicaieri. */}
          {!reviewingAll && photos.length > total && (
            <button type="button" className="tiktok-review-all-chip" onClick={reviewAll}>
              {tr('tiktok.reviewAll.short', { count: photos.length })}
            </button>
          )}
          <div className="tiktok-up-hint"><ChevronUpIcon aria-hidden="true" /><span>{tr('tiktok.hint')}</span></div>

          <div
            className="tiktok-stage-wrap"
            ref={stageWrapRef}
            style={{ transform: `translateY(${dragY}px)`, transition: draggingRef.current ? 'none' : 'transform 0.25s var(--ease)' }}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
            onPointerCancel={onStageUp}
            onClick={onStageClick}
          >
            {src && (
              <AdjustedImage
                src={src}
                alt=""
                className={zoomScale !== 1 ? 'tiktok-stage zoomed' : 'tiktok-stage'}
                style={zoomScale !== 1
                  ? {
                      transform: `scale(${zoomScale}) translate(${zoomPan.x / zoomScale}px, ${zoomPan.y / zoomScale}px)`,
                      transition: zoomGestureActiveRef.current ? 'none' : 'transform 0.2s var(--ease)'
                    }
                  : undefined}
              />
            )}
          </div>
          {zoomScale !== 1 && <span className="tiktok-zoom-hint mono">{Math.round(zoomScale * 100)}%</span>}
          <div className="tiktok-veil-top" aria-hidden="true" />
          <div className="tiktok-veil-bottom" aria-hidden="true" />

          {/* Blocul de informatii, dupa a doua plangere a utilizatorului ("acopera
              asa mult din imagine"): DOUA randuri, nu patru. Toate scurtaturile
              — recomandarea AI, seria, metricile — sunt pastile pe acelasi rand,
              iar motivele si data intra pe un singur rand care se taie cu "..."
              in loc sa curga pe mai multe. */}
          <div className="tiktok-caption">
            <div className="tiktok-chip-row">
              {/* Pe o poza DECISA, pastila devine buton: deschide "De ce ai decis
                  asa?". Cerinta directa a utilizatorului — vrea sa spuna
                  motivul ca motorul sa invete din el. Locul e cel firesc:
                  chiar acolo scrie ce a hotarat. */}
              {verdict && (verdict.kind === 'mine' ? (
                <button
                  type="button"
                  className={`tiktok-ai-chip mine-${verdict.status}`}
                  title={tr('explain.open')}
                  onClick={() => setExplainPhotoId(current.id)}
                >
                  {/* Fara scanteie: aia inseamna "AI-ul zice", si aici nu el zice. */}
                  <CheckIcon className="inline-icon" aria-hidden="true" />
                  {tr(`tiktok.mine.short.${verdict.status}`)} · {current.aiScore}
                  <b className="tiktok-explain-cue">{tr('explain.open')}</b>
                </button>
              ) : (
                <span className={`tiktok-ai-chip rec-${verdict.recommendation}`} title={tr(`tiktok.ai.${verdict.recommendation}`)}>
                  <SparkleIcon className="inline-icon" aria-hidden="true" />
                  {tr(`tiktok.ai.short.${verdict.recommendation}`)} · {current.aiScore}
                </span>
              ))}
              {/* Cerinta directa a utilizatorului: eticheta spunea "parte dintr-o
                  serie de 3" si nu facea nimic — ca sa scapi de dubluri trebuia
                  sa iesi din sortare, sa cauti seria, si sa reiei coada de la
                  capat. Acum deschide compararea seriei PESTE sortare; la
                  inchiderea ei, coada continua exact de unde a ramas. */}
              {seriesCount > 1 && current.groupId && (
                <button
                  type="button"
                  className="tiktok-ai-chip tiktok-series-chip"
                  onClick={() => openCompare(current.groupId!)}
                >
                  <LayersIcon className="inline-icon" aria-hidden="true" />
                  {tr('tiktok.caption.seriesShort', { count: seriesCount })}
                </button>
              )}
              {/* Cerinta directa: din sortarea rapida trebuie sa se ajunga la
                  metrici si la editare, fara sa iesi in grila. Deschide aceeasi
                  foaie de detaliu (Metrici / De ce acest scor / Persoane /
                  Istoric), peste ecranul de sortare, care ramane montat. */}
              <button
                type="button"
                className="tiktok-ai-chip tiktok-metrics-chip"
                aria-label={tr('tiktok.metrics')}
                onClick={() => {
                  openDetail(current.id, { expandMetrics: true });
                  // In spatiul de lucru metricile se deschid in foaia LUI, care e
                  // sub sortarea rapida — daca ramanem aici, utilizatorul apasa si
                  // nu vede nimic. In ramura principala DetailView se deschide
                  // PESTE sortare, iar inchiderea lui readuce coada: acolo ramanem.
                  if (useStore.getState().workspaceMode) setOpen(false);
                }}
              >
                <BarChartIcon className="inline-icon" aria-hidden="true" />
                {tr('tiktok.metrics.short')}
              </button>
            </div>
            {(reasonsText || captureDate || album) && (
              <p className="tiktok-caption-line">
                {reasonsText && <span className="tiktok-caption-why">{reasonsText}</span>}
                {(captureDate || album) && (
                  <span className="tiktok-caption-meta">{[captureDate, album].filter(Boolean).join(' · ')}</span>
                )}
              </p>
            )}
          </div>
        </>
      )}

      {/* Anuleaza ramane disponibil si dupa ce coada s-a golit (ultima decizie
          luata chiar aici e adesea exact cea pe care utilizatorul vrea sa o
          revizuiasca) — nu doar cat timp mai exista o poza curenta de decis. */}
      <div className="tiktok-rail">
        {current && (
          <>
            <span className="tiktok-rail-item rail-keep">
              <button className="tiktok-rail-btn keep" onClick={() => decide('selected')} aria-label={tr('tiktok.rail.keep')}>
                <HeartIcon />
              </button>
              <span className="tiktok-rail-label">{tr('tiktok.rail.keep')}</span>
            </span>
            <span className="tiktok-rail-item rail-album">
              <CollectionPicker photoIds={[current.id]} iconOnly triggerClassName="tiktok-rail-btn album" />
              <span className="tiktok-rail-label">{tr('tiktok.rail.album')}</span>
            </span>
            {/* A treia decizie. Fara ea, orice cadru la care omul se codeste
                trebuie fortat intr-un "da" sau intr-un "nu" — iar cadrul afectiv
                sau comercial pe care nu vrei sa-l pierzi, dar nici nu-l dai inca
                mai departe, n-avea unde sa mearga. Vezi PhotoStatus in core/db.ts:
                nicio operatie automata nu-l mai atinge dupa aceea. */}
            <span className="tiktok-rail-item rail-candidate">
              <button className="tiktok-rail-btn candidate" onClick={() => decide('candidate')} aria-label={tr('tiktok.rail.candidate')}>
                <BookmarkIcon />
              </button>
              <span className="tiktok-rail-label">{tr('tiktok.rail.candidate')}</span>
            </span>
            {/* "Resping", nu "Sterg". Butonul apeleaza decide('rejected') — muta
                poza in "respinse", nu o scoate de pe telefon. Iar aplicatia ARE o
                stergere adevarata, "Sterge pozele respinse", care chiar cere
                sistemului sa stearga fisiere. Cat timp cel mai apasat buton rosu
                de pe ecranul principal de lucru spunea "Sterg", ori omul il ocolea
                de frica, ori credea ca a sters poze pe care nu le stersese.
                Gasit la auditul de interfata. */}
            <span className="tiktok-rail-item rail-del">
              <button className="tiktok-rail-btn del" onClick={() => decide('rejected')} aria-label={tr('tiktok.rail.reject')}>
                <XIcon />
              </button>
              <span className="tiktok-rail-label">{tr('tiktok.rail.reject')}</span>
            </span>
          </>
        )}
        {/* Aceeasi structura ca celelalte trei celule (buton + eticheta): grila
            barei aliniaza pe randul de jos, iar o celula fara eticheta isi urca
            butonul cu inaltimea etichetei lipsa — de aici iesea din rand. */}
        <span className="tiktok-rail-item rail-undo">
          <button className="tiktok-rail-btn undo" onClick={doUndo} aria-label={tr('tiktok.rail.undo')}>
            <UndoIcon />
          </button>
          {/* Eticheta vizibila e scurta: "Anulează ultima decizie" pe o coloana
              de un sfert din latimea ecranului iesea din bara. Textul complet
              ramane in aria-label, unde conteaza pentru cititoarele de ecran. */}
          <span className="tiktok-rail-label">{tr('tiktok.rail.undoShort')}</span>
        </span>
      </div>
    </div>
  );
}
