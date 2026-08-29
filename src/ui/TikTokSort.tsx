import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { selectSortQueue, selectScopedQueue, selectAllPhotosQueue, countSeriesSiblings } from '../state/tiktokSort';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { db } from '../core/db';
import { RAW_EXTENSIONS } from '../core/rawDecoder';
import { SELECT_THRESHOLD, REJECT_THRESHOLD } from '../core/importPipeline';
import { explainFactors } from '../core/learning/ContextEngine';
import { useModalFocusTrap } from './useModalFocusTrap';
import { CollectionPicker } from './CollectionPicker';
import { AdjustedImage } from './AdjustedImage';
import { computeMenuPosition, isInsideAnyMenu, useReanchorOnViewportChange, type MenuPosition } from './dropdownPosition';
import {
  XIcon, UndoIcon, ChevronUpIcon, SparkleIcon, LayersIcon, BookmarkIcon, BarChartIcon, CheckIcon,
  MoreIcon, SmileIcon, EyeIcon, FocusIcon, TagIcon
} from './icons';
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

/** Formatul REAL al fisierului (mockup "Lumin Culler Pro" arata un badge "RAW" in coltul pozei) — din numele fisierului, nu ghicit. */
function photoFormatLabel(fileName: string): string {
  if (RAW_EXTENSIONS.test(fileName)) return 'RAW';
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1];
  return ext ? ext.toUpperCase() : '';
}

function formatCaptureDate(ts: number | undefined, locale: Locale): string | null {
  if (!ts) return null;
  const intlLocale = locale === 'en' ? 'en-US' : 'ro-RO';
  return new Date(ts).toLocaleDateString(intlLocale, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Aceeasi paleta pick/review/reject ca ScoreRing din PhotoInfoTabs — un singur cod de culoare pentru scor, oriunde apare. */
function scoreColorOf(score: number): string {
  return score >= 65 ? 'var(--pick)' : score <= 35 ? 'var(--reject)' : 'var(--review)';
}

/**
 * O miniatura din filmstrip-ul seriei (mockup "Lumin Culler Pro"). Cache-ul de
 * thumbnail-uri e comun cu grila — de obicei e deja "cald" cand ajungi aici
 * din triaj, deci `peekThumbUrl` gaseste direct imaginea, fara sa astepte re-randarea.
 */
function FilmstripThumb({ photo, active, onSelect }: { photo: PhotoView; active: boolean; onSelect: () => void }) {
  const [src, setSrc] = useState<string | null>(() => peekThumbUrl(photo.id));
  useEffect(() => {
    if (src) return;
    let alive = true;
    void getCachedThumbUrl(photo.id).then(url => { if (alive && url) setSrc(url); });
    return () => { alive = false; };
  }, [photo.id, src]);
  return (
    <button
      type="button"
      className={active ? 'tiktok-filmstrip-item active' : 'tiktok-filmstrip-item'}
      onClick={onSelect}
      aria-current={active}
    >
      {src && <img src={src} alt="" />}
    </button>
  );
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
  const groupOf = useStore(s => s.groupOf);
  const setStatus = useStore(s => s.setStatus);
  const setExplainPhotoId = useStore(s => s.setExplainPhotoId);
  const undo = useStore(s => s.undo);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const [queueIds, setQueueIds] = useState<string[]>([]);
  /** Poza tocmai decisa, cat timp invitatia "De ce?" e pe ecran. Null = nimic de intrebat. */
  const [justDecided, setJustDecided] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open, true);

  /**
   * "Mai multe" (mockup "Lumin Culler Pro") — Album/Candidat/Anulează, mutate
   * din bara principala (care acum are DOAR cele doua decizii dominante,
   * Pastrez/Resping, ca in mockup) intr-un meniu discret, deschis din antet.
   * Nimic din functionalitate nu s-a pierdut, doar locul s-a schimbat — acelasi
   * tipar de portal/pozitionare ca CollectionPicker/SceneTagFilter (vezi
   * dropdownPosition.ts), ca sa nu reinventam bug-urile deja rezolvate acolo
   * (reancorare la scroll/rotire, meniu taiat de marginea ecranului).
   */
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState<MenuPosition | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const placeMoreMenu = (rect: DOMRect) => setMoreMenuPos(computeMenuPosition(rect));
  useReanchorOnViewportChange(moreOpen, moreTriggerRef, placeMoreMenu);
  const toggleMore = () => {
    if (!moreOpen) {
      const rect = moreTriggerRef.current?.getBoundingClientRect();
      if (rect) placeMoreMenu(rect);
    }
    setMoreOpen(v => !v);
  };
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (moreTriggerRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      if (isInsideAnyMenu(e.target)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

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

  // Cutiile fetelor detectate (date REALE, vezi acelasi principiu in
  // DetailView.tsx) — pentru conturul din jurul fetei pe ecranul de sortare
  // (mockup "Lumin Culler Pro"). Nicio dependinta de landmark-uri exacte (nu
  // le avem), doar cutia.
  const [faceBoxes, setFaceBoxes] = useState<[number, number, number, number][]>([]);
  useEffect(() => {
    if (!current) { setFaceBoxes([]); return; }
    let alive = true;
    void db.analyses.get(current.id).then(a => { if (alive) setFaceBoxes(a?.faces.map(f => f.box) ?? []); });
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


  /**
   * Invitatia se stinge singura. Sase secunde: destul cat sa apuci sa apesi
   * daca chiar ai un motiv, prea putin cat sa stea in drum daca nu ai.
   */
  useEffect(() => {
    if (!justDecided) return;
    const timer = setTimeout(() => setJustDecided(null), 6000);
    return () => clearTimeout(timer);
  }, [justDecided]);

  if (!open) return null;

  const goNext = () => setIndex(i => Math.min(i + 1, total));
  const goPrev = () => setIndex(i => Math.max(i - 1, 0));
  /**
   * O decizie, si imediat sansa de a spune DE CE.
   *
   * Cerinta utilizatorului, dupa ce a patit-o: "la fotografia cu spray am dat
   * respinge, a aparut ca a invatat ISO — a trebuit sa revin inapoi ca sa dau
   * de ce". Adica singurul moment in care stia motivul era exact momentul in
   * care aplicatia il ducea deja mai departe.
   *
   * Acum, dupa "Pastrez" sau "Resping", pastila cu decizia primeste o umbra de
   * cateva secunde pe care scrie "De ce?". Cine o apasa deschide foaia de
   * motive; cine n-o apasa nu pierde nimic — se stinge singura si coada merge
   * mai departe. Deliberat NU un dialog: o intrebare care blocheaza dupa
   * FIECARE poza ar transforma triajul rapid in exact opusul lui.
   *
   * "Candidat" nu primeste invitatia: a pune o poza deoparte inseamna tocmai
   * ca inca nu te-ai hotarat, deci n-ai ce motiv sa dai.
   */
  const decide = (status: 'selected' | 'rejected' | 'candidate') => {
    if (!current) return;
    const decided = current.id;
    void setStatus(decided, status);
    if (status !== 'candidate') setJustDecided(decided);
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
  // Membrii reali ai seriei, pentru filmstrip (mockup "Lumin Culler Pro") — acelasi
  // grup (hash perceptual) ca seriesCount de mai sus, doar ca lista, nu doar numar.
  const seriesMembers = current?.groupId ? groupOf(current.groupId) : [];
  const captureDate = current ? formatCaptureDate(current.capturedAt, locale) : null;
  const formatLabel = current ? photoFormatLabel(current.fileName) : '';
  const album = current ? (collections.find(c => c.memberIds.includes(current.id))?.name ?? current.project) : undefined;
  const verdict = current ? captionVerdict(current) : null;
  const reasonsText = current ? topReasonsText(current, locale) : null;

  return (
    <div className="tiktok-sort" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('tiktok.title')} tabIndex={-1}>
      {/* Bara de sus, ca RAND, nu ca patru piese asezate absolut.
          Bug real raportat de utilizator ("butonul toate se suprapune peste
          liniuțe") si masurat: liniuțele de progres tineau `right: 82px`, iar
          chipul "Toate N" statea la `right: 76px` cu ~75px latime — deci
          liniuțele se terminau la x=330 si chipul incepea la x=261. 69px unul
          peste altul. Marginile fixe fusesera potrivite pentru cazul FARA chip,
          si nimic nu le reajusta cand acesta aparea. La fel se taia si contorul
          "1/10" pe ecrane mai inguste.
          Intr-un rand flex problema nu mai poate exista: progresul ia ce ramane,
          restul isi cer latimea lor, si se imping unele pe altele. */}
      {/* Marca — mockup "Lumin Culler Pro" arata brand-ul si aici, nu doar pe
          ecranul gol. Rand separat, nu inclus in bara functionala de mai jos
          (progres/"Toate N"/contor): acolo fiecare piesa isi are deja
          latimea ei calculata din bug-uri reale (vezi comentariul de mai
          sus), si n-a mai ramas loc pentru inca un element pe ecrane
          inguste. */}
      <div className="tiktok-brand-row" aria-hidden="true">
        <span className="tiktok-brand">Lumin<b>Culler</b> Pro</span>
      </div>
      <div className="tiktok-topbar">
        <button className="tiktok-close" onClick={() => setOpen(false)} aria-label={tr('tiktok.close')}>
          <XIcon />
        </button>

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
            {/* Trecerea la toata biblioteca, fara sa iesi din ecran. Apare doar
                cat timp coada e cea scurta (nedecise) si chiar exista mai multe
                poze decat atat — altfel butonul n-ar duce nicaieri. */}
            {!reviewingAll && photos.length > total && (
              <button type="button" className="tiktok-review-all-chip" onClick={reviewAll}>
                {tr('tiktok.reviewAll.short', { count: photos.length })}
              </button>
            )}
            <span className="tiktok-progress-count mono" aria-hidden="true">{index + 1}/{total}</span>
            {/* Album/Candidat/Anulează traiesc aici acum, nu mai in bara de jos
                (mockup "Lumin Culler Pro") — vezi comentariul de la moreOpen. */}
            <button
              ref={moreTriggerRef}
              type="button"
              className="tiktok-more-trigger"
              onClick={toggleMore}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label={tr('tiktok.more')}
            >
              <MoreIcon />
            </button>
          </>
        )}
      </div>

      {/* Ecranul "totul sortat" traieste in afara .tiktok-topbar — era copil al
          lui inainte, dar .tiktok-topbar e position:absolute (fara inaltime
          proprie, doar cat butonul de inchidere), asa ca acest ecran
          (position:absolute;inset:0, gandit sa acopere tot .tiktok-sort)
          se ancora de fapt de cutia mica a antetului, nu de ecran — bug real
          raportat de utilizator ("arata dezordonat", cu X-ul plutind in
          mijlocul ecranului in loc de coltul din stanga sus). */}
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

      {current && moreOpen && moreMenuPos && createPortal(
        <div
          ref={moreMenuRef}
          role="menu"
          className="scene-tag-filter-menu tiktok-more-menu"
          style={{ position: 'fixed', left: moreMenuPos.left, right: moreMenuPos.right, top: moreMenuPos.top, bottom: moreMenuPos.bottom, maxHeight: moreMenuPos.maxHeight }}
        >
          <CollectionPicker photoIds={[current.id]} triggerClassName="scene-tag-filter-option tiktok-more-item" />
          <button type="button" className="scene-tag-filter-option tiktok-more-item" onClick={() => { decide('candidate'); setMoreOpen(false); }}>
            <BookmarkIcon className="inline-icon" aria-hidden="true" /> <span>{tr('tiktok.rail.candidate')}</span>
          </button>
          <button type="button" className="scene-tag-filter-option tiktok-more-item" onClick={() => { doUndo(); setMoreOpen(false); }}>
            <UndoIcon className="inline-icon" aria-hidden="true" /> <span>{tr('tiktok.rail.undoShort')}</span>
          </button>
        </div>,
        document.body
      )}

      {current && (
        <>
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
              <span className="tiktok-face-frame">
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
                {/* Conturul REAL al fetei (FaceInsight.box) — vezi comentariul de
                    la faceBoxes mai sus. Ascuns cat timp fotografia e marita: la
                    zoomScale>1 imaginea nu mai umple invelisul auto-dimensionat,
                    deci pozitia procentuala nu mai corespunde. */}
                {zoomScale === 1 && faceBoxes.map(([bx, by, bw, bh], i) => (
                  <span
                    key={i} className="detail-face-box tiktok-face-box" aria-hidden="true"
                    style={{ left: `${bx * 100}%`, top: `${by * 100}%`, width: `${bw * 100}%`, height: `${bh * 100}%` }}
                  />
                ))}
                {/* Formatul real al fisierului (mockup "Lumin Culler Pro") —
                    ancorat la coltul cutiei care se micsoreaza cu poza (nu al
                    containerului plin ecran), deci ramane lipit de imagine la
                    orice raport de aspect. */}
                {formatLabel && <span className="tiktok-format-badge mono" aria-hidden="true">{formatLabel}</span>}
              </span>
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
            {(captureDate || album) && (
              <p className="tiktok-caption-line">
                <span className="tiktok-caption-meta">{[captureDate, album].filter(Boolean).join(' · ')}</span>
              </p>
            )}
            {/* Filmstrip cu restul seriei (mockup "Lumin Culler Pro") — un tap pe
                un cadru sare direct la el, daca mai e in coada de triaj; daca a
                fost deja decis in alta parte (nu mai e in coada), deschide
                compararea completa a seriei, unde tot ramane vizibil. */}
            {seriesCount > 1 && seriesMembers.length > 0 && (
              <div className="tiktok-filmstrip" role="list" aria-label={tr('tiktok.caption.seriesShort', { count: seriesCount })}>
                {seriesMembers.map(m => (
                  <FilmstripThumb
                    key={m.id}
                    photo={m}
                    active={m.id === current.id}
                    onSelect={() => {
                      const qi = queueIds.indexOf(m.id);
                      if (qi >= 0) setIndex(qi);
                      else if (current.groupId) openCompare(current.groupId);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Card de scor pe toata latimea, sub filmstrip (mockup "Lumin
                Culler Pro" — nu o pastila plutitoare peste poza). Aceleasi
                date ca fisa de metrici (PhotoInfoTabs): scorul AI, plus
                zambet/ochi (doar cand exista o fata reala, altfel n-avem
                niciun semnal onest de aratat) si claritatea. */}
            <div className="tiktok-score-card">
              <span className="tiktok-score-handle" aria-hidden="true" />
              <div className="tiktok-score-head" aria-hidden="true">
                <div className="tiktok-score-gauge" style={{ background: `conic-gradient(${scoreColorOf(current.aiScore)} ${Math.round((current.aiScore / 100) * 360)}deg, rgba(255,255,255,.16) 0)` }}>
                  <span className="tiktok-score-gauge-inner">
                    <b style={{ color: scoreColorOf(current.aiScore) }}>{current.aiScore}</b>
                    <i>/100</i>
                  </span>
                </div>
                <div className="tiktok-score-metrics">
                  {current.faceCount > 0 && (
                    <>
                      <div className="tiktok-score-metric">
                        <SmileIcon aria-hidden="true" />
                        <span>{tr(current.faceCount > 1 ? 'detail.stat.smiles' : 'detail.stat.smile')}</span>
                        <i><b style={{ width: `${Math.round((current.faceCount > 1 ? current.groupSmileRatio ?? current.bestSmile : current.bestSmile) * 100)}%` }} /></i>
                        <b className="tiktok-score-metric-pct">{Math.round((current.faceCount > 1 ? current.groupSmileRatio ?? current.bestSmile : current.bestSmile) * 100)}%</b>
                      </div>
                      <div className="tiktok-score-metric">
                        <EyeIcon aria-hidden="true" />
                        <span>{tr(current.faceCount > 1 ? 'detail.stat.eyesGroup' : 'detail.stat.eyesOk')}</span>
                        <i><b style={{ width: `${Math.round((current.faceCount > 1 ? current.groupEyesOpenRatio ?? (current.allEyesOpen ? 1 : 0) : (current.allEyesOpen ? 1 : 0)) * 100)}%` }} /></i>
                        <b className="tiktok-score-metric-pct">{Math.round((current.faceCount > 1 ? current.groupEyesOpenRatio ?? (current.allEyesOpen ? 1 : 0) : (current.allEyesOpen ? 1 : 0)) * 100)}%</b>
                      </div>
                    </>
                  )}
                  <div className="tiktok-score-metric">
                    <FocusIcon aria-hidden="true" />
                    <span>{tr('detail.stat.sharpness')}</span>
                    <i><b style={{ width: `${Math.round(current.sharpness)}%` }} /></i>
                    <b className="tiktok-score-metric-pct">{Math.round(current.sharpness)}%</b>
                  </div>
                </div>
              </div>
              {/* Context real (tipul de cadru + daca subiectul e o persoana
                  deja recunoscuta) — aceleasi campuri ca Persoane/Metrici, nu
                  un text inventat. */}
              <span className="tiktok-score-context">
                <TagIcon className="inline-icon" aria-hidden="true" />
                {tr('tiktok.score.context')}: {tr(`insights.scene.${current.sceneType}`)}
                {current.faceCount > 0 && ` · ${tr(current.knownFaceCount > 0 ? 'tiktok.score.known' : 'tiktok.score.stranger')}`}
              </span>
              {/* Motivele scorului (mockup arata exact acest text sub context) —
                  nu mai apar si in randul de sub pastile, vezi tiktok-caption-line mai jos. */}
              {reasonsText && (
                <p className="tiktok-score-insight">
                  <SparkleIcon className="inline-icon" aria-hidden="true" />
                  <span className="tiktok-score-insight-text">{reasonsText}</span>
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Anuleaza ramane disponibil si dupa ce coada s-a golit (ultima decizie
          luata chiar aici e adesea exact cea pe care utilizatorul vrea sa o
          revizuiasca) — nu doar cat timp mai exista o poza curenta de decis. */}
      {/* Invitatia de a spune DE CE, imediat dupa decizie. Sta DEASUPRA barei de
          actiuni, nu peste poza: acolo tocmai s-a intamplat ceva, deci acolo se
          uita ochiul. Se stinge singura in sase secunde — vezi decide(). */}
      {justDecided && (
        <div className="tiktok-why" role="status">
          <span>{tr('tiktok.why.prompt')}</span>
          <button
            type="button"
            className="tiktok-why-btn"
            onClick={() => { setExplainPhotoId(justDecided); setJustDecided(null); }}
          >
            {tr('explain.open')}
          </button>
          <button
            type="button"
            className="tiktok-why-close"
            aria-label={tr('detail.close')}
            onClick={() => setJustDecided(null)}
          >
            <XIcon />
          </button>
        </div>
      )}

      {/* Doar cele doua decizii — mockup "Lumin Culler Pro" arata exact doua
          butoane mari, nu cinci egale. Album/Candidat/Anulează n-au disparut:
          traiesc acum in meniul "..." din antet (vezi moreOpen mai sus) —
          nicio functie reala nu s-a pierdut, doar ierarhia vizuala s-a
          schimbat, ca decizia principala sa fie evidenta dintr-o privire. */}
      {current && (
        <div className="tiktok-rail">
          <button className="tiktok-rail-btn del" onClick={() => decide('rejected')}>
            {/* Bifa/X in cerc, ca in mockup "Lumin Culler Pro" — CheckIcon e
                deja simbolul "pastrat" folosit pe pastila de verdict de mai
                sus (tiktok-ai-chip.mine-selected), asa ca cele doua butoane
                mari repeta acelasi cod vizual, nu unul nou (inima). */}
            <span className="tiktok-rail-btn-icon"><XIcon aria-hidden="true" /></span>
            <span>{tr('tiktok.rail.reject')}</span>
          </button>
          <button className="tiktok-rail-btn keep" onClick={() => decide('selected')}>
            <span className="tiktok-rail-btn-icon"><CheckIcon aria-hidden="true" /></span>
            <span>{tr('tiktok.rail.keep')}</span>
          </button>
        </div>
      )}
      {/* Acelasi indiciu de gest ca in mockup — textul explica pe scurt ce
          face swipe-ul orizontal, ramas disponibil pe langa cele doua
          butoane pentru cine prefera atingerea directa. */}
      {current && <p className="tiktok-swipe-hint">{tr('tiktok.swipeHint')}</p>}
    </div>
  );
}
