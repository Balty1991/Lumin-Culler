import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore, isAnyOverlayOpen, type PhotoView } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { StarRating } from './StarRating';
import { PhotoInfoTabs } from './PhotoInfoTabs';
import { ScoreReason } from './ScoreReason';
import { XIcon, ChevronLeft, ChevronRight, ChevronUpIcon, LayersIcon, CheckIcon, EditIcon } from './icons';
import { CollectionPicker } from './CollectionPicker';
import { EASE } from './motion';
import { AdjustedImage } from './AdjustedImage';
import { t } from '../i18n';

const SWIPE_COMMIT = 96;       // px de tras pentru a declansa decizia
const SWIPE_TAP_TOLERANCE = 6; // sub asta e considerat click (zoom), nu swipe

/**
 * Randat doar cat timp exista o poza (vezi DetailView mai jos) — separat intr-o
 * componenta proprie ca sa primeasca `photo` NEnulabil (evita null-checks peste
 * tot) fara sa strice animatia de iesire: DetailView pastreaza AnimatePresence
 * montat permanent, doar acest continut apare/dispare condiţionat, iar
 * navigarea intre poze (sageti) NU remonteaza componenta (fara `key={photo.id}`
 * — altfel fiecare Sageata ar re-juca intrarea, nu doar Escape/X).
 */
/** Praguri de tras (px) pentru gestul vertical de Bottom Sheet — acelasi principiu ca SWIPE_COMMIT orizontal de mai sus. */
const SHEET_DRAG_COMMIT = 56;
/**
 * Inaltimea vizibila a manerului cat timp sheet-ul e restrans — trebuie sa fie
 * IDENTICA cu valoarea din CSS (.detail-sheet, translateY collapsed). Marita
 * incremental de la 58 (66, apoi 74) dupa 3 runde de feedback pe acelasi device
 * real (navigare pe 3 butoane): env(safe-area-inset-bottom) raporteaza 0 acolo,
 * spre deosebire de un home-indicator gesture-nav. Cauza radacina identificata
 * acum: targetSdkVersion 36 forteaza edge-to-edge pe Android 15+ (API 35), iar
 * WebView-ul deseneaza sub bara de navigare fara sa propage inaltimea ei catre
 * CSS — fixata la nivel de tema nativa (android:windowOptOutEdgeToEdgeEnforcement
 * in android/app/src/main/res/values/styles.xml). 86px ramane ca respiro vizual
 * generos peste acel fix structural, nu ca inca o incercare-ghici izolata.
 */
const SHEET_PEEK_PX = 86;

function DetailContent({ photo, reduceMotion }: { photo: PhotoView; reduceMotion: boolean }) {
  const imagesRevision = useStore(s => s.imagesRevision);
  const openDetail = useStore(s => s.openDetail);
  const openCompare = useStore(s => s.openCompare);
  const openEdit = useStore(s => s.openEdit);
  const stepDetail = useStore(s => s.stepDetail);
  const setStatus = useStore(s => s.setStatus);
  const setRating = useStore(s => s.setRating);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [src, setSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [dragX, setDragX] = useState(0);
  // Aceeasi tehnica (si acelasi bug real, gasit de auditul QA) ca sheetDragYRef
  // mai jos: gestul ORIZONTAL e cel care chiar muta statusul pozei (selectat/
  // respins) la commitSwipe, deci un pointerup ce vine imediat dupa ultimul
  // pointermove (fara randare intre ele) putea vedea in endDrag o valoare
  // VECHE a lui `dragX` din closure — un flick rapid risca sa nu comita
  // deloc, sau sa comita pe baza unei distante usor invechite. Fisierul
  // remediase deja exact acest tipar pentru gestul vertical (sheet), dar nu
  // si pentru cel orizontal, singurul care schimba efectiv decizia.
  const dragXRef = useRef(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Bottom Sheet (plan "Refactorizare UI/UX"): metricile/tab-urile nu mai stau permanent
  // pe ecran — traiesc intr-un panou retractabil, deschis explicit (tap pe maner sau swipe up).
  // Cand deschiderea a cerut explicit metricile (butonul din sortarea rapida),
  // foaia porneste desfasurata: altfel utilizatorul apasa "metrici", ajunge pe
  // alt ecran, si trebuie sa apese "METRICI" a doua oara ca sa vada acelasi lucru.
  const expandMetricsOnOpen = useStore(s => s.detailExpandMetrics);
  const [sheetExpanded, setSheetExpanded] = useState(expandMetricsOnOpen);
  /**
   * Deschiderea a venit din pastila "Metrici" a sortarii rapide, si inca suntem
   * pe aceeasi poza. Atunci strangerea foii inseamna "am terminat, du-ma inapoi
   * la coada", nu "arata-mi ecranul de dedesubt": raportat de utilizator cu
   * captura — la minimizare ajungea pe un ecran intermediar cu poza si doua
   * butoane rotunde, din care doar X-ul il scotea. Se stinge cum navigheaza la
   * alta poza: de acolo incolo ecranul e al lui, nu o fereastra spre metrici.
   */
  const cameFromSortRef = useRef(expandMetricsOnOpen);
  const collapseSheet = () => {
    if (cameFromSortRef.current) openDetail(null);
    else setSheetExpanded(false);
  };
  /**
   * Cererea de a deschide rationamentul complet, venita din linia de motiv de
   * deasupra butoanelor de decizie (ScoreReason). Deschide foaia SI pune fila
   * "De ce acest scor" — pana acum, ca sa afli de ce a decis AI-ul asa, trebuia
   * sa tragi foaia in sus si sa nimeresti fila.
   */
  const [openTab, setOpenTab] = useState<{ tab: 'why'; at: number } | undefined>(undefined);
  const explainScore = () => { setOpenTab({ tab: 'why', at: Date.now() }); setSheetExpanded(true); };
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetDraggingRef = useRef(false);
  const sheetMovedRef = useRef(false);
  const sheetStartYRef = useRef(0);
  // Valoarea "de adevar" pentru decizia de comitere — un ref, nu doar starea `sheetDragY`
  // (folosita doar pentru stilul inline in timpul tragerii): la un pointerup care vine
  // imediat dupa ultimul pointermove (fara randare intre ele), closure-ul lui endSheetDrag
  // ar putea vedea inca vechea valoare din state daca s-ar baza pe ea. Ref-ul e mereu la zi.
  const sheetDragYRef = useRef(0);
  // constant true: DetailContent monteaza o singura data cat timp panoul e deschis
  // (navigarea intre poze cu sagetile NU remonteaza, vezi comentariul de mai jos) —
  // capcana de focus trebuie sa se activeze o singura data la deschidere, nu la
  // fiecare schimbare de poza (altfel ar fura focusul vizibil la fiecare sageata)
  useModalFocusTrap(containerRef, true, true);

  // Efectul de mai jos ruleaza si la MONTARE, nu doar la schimbarea pozei, iar
  // acolo `setSheetExpanded(false)` anula imediat starea ceruta la deschidere
  // (vezi expandMetricsOnOpen) — de aceea butonul "Vezi metricile si editarea"
  // din sortarea rapida ajungea tot pe o foaie stransa, si trebuia apasat
  // "METRICI" inca o data. Colapsam doar cand se schimba efectiv poza.
  const photoChangedRef = useRef(false);

  useEffect(() => {
    setZoomed(false);
    dragXRef.current = 0;
    setDragX(0);
    if (photoChangedRef.current) { setSheetExpanded(false); cameFromSortRef.current = false; }
    photoChangedRef.current = true;
    let alive = true;
    // Curatam src-ul VECHI inainte de a incepe fetch-ul nou — altfel, pana la rezolvarea
    // promisiunii (LRU-ul din previewUrlCache.ts tine doar 40 de intrari, deci navigarea
    // rapida printr-o biblioteca mare da frecvent cache miss), numele/EXIF/rating deja
    // reflecta poza NOUA dar imaginea afisata e inca cea VECHE — bug real gasit de auditul
    // QA, aceeasi clasa deja evitata corect in GroupCompare.tsx (usePreviewUrl).
    setSrc(null);
    void getCachedPreviewUrl(photo.id).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
    // `imagesRevision` in dependinte: fara el, o poza careia i s-au COPT
    // editarile (buton "Aplica") ramanea pe ecran asa cum arata inainte —
    // `photo.id` nu se schimba la intoarcerea din editor, deci efectul asta nu
    // se mai executa niciodata, si `src` pastra URL-ul vechi. Vezi
    // imagesRevision in state/store.ts.
  }, [photo.id, imagesRevision]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignora tastarea in orice camp text (ex. cautarea din Paleta de comenzi) —
      // vezi acelasi gardian in Workspace.tsx
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Acelasi gardian ca in Workspace.tsx (vezi comentariul detaliat de acolo):
      // fara el, Ctrl/Cmd+X taia textul SI respingea poza, Ctrl/Cmd+P deschidea
      // tiparirea SI o selecta, Ctrl/Cmd+1..5 schimba fila din browser SI ii
      // schimba nota — decizii ireversibile luate in spatele unui dialog nativ.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') stepDetail(1);
      else if (e.key === 'ArrowLeft') stepDetail(-1);
      // Bug real gasit de auditul QA (suggestion, consistenta): Workspace avanseaza
      // automat la urmatoarea poza dupa o decizie (tastatura, FAB) — DetailView nu
      // o facea deloc pe niciuna din cele 3 cai (tastatura/swipe/FAB), desi
      // ShortcutsPanel le eticheteaza identic ("selecteaza/respinge poza curenta"),
      // fara nicio nota despre diferenta de comportament intre cele doua ecrane.
      else if (e.key === 'p' || e.key === 'P') { void setStatus(photo.id, 'selected'); stepDetail(1); }
      else if (e.key === 'x' || e.key === 'X') { void setStatus(photo.id, 'rejected'); stepDetail(1); }
      else if (e.key === 'z' || e.key === 'Z') setZoomed(z => !z);
      else if (e.key >= '0' && e.key <= '5') void setRating(photo.id, photo.rating === Number(e.key) ? 0 : Number(e.key));
      else if (e.key === 'Escape') {
        // acelasi motiv ca in Workspace.tsx: stopPropagation() dintr-un alt
        // listener de pe window NU opreste acest listener sa ruleze (doar
        // propagarea intre elemente diferite) — verificam direct starea.
        // Bug real gasit de auditul QA: lipseau majoritatea panourilor din
        // aceasta lista, deci Escape inchidea DetailView pe sub un panou
        // deschis (ex. Editare de baza) in loc sa-l inchida pe acela.
        // vezi isAnyOverlayOpen() in state/store.ts — o singura lista, nu trei
        if (isAnyOverlayOpen()) return;
        openDetail(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo.id, photo.rating, stepDetail, setStatus, setRating, openDetail]);

  const commitSwipe = (status: 'selected' | 'rejected') => {
    // vibrate() e apelat acum din interiorul store.setStatus (toate caile de decizie,
    // nu doar swipe) — vezi comentariul de acolo.
    void setStatus(photo.id, status);
    stepDetail(1); // vezi comentariul de la handler-ul de tastatura mai sus
    dragXRef.current = 0;
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
    dragXRef.current = delta;
    setDragX(delta);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragXRef.current > SWIPE_COMMIT) commitSwipe('selected');
    else if (dragXRef.current < -SWIPE_COMMIT) commitSwipe('rejected');
    else { dragXRef.current = 0; setDragX(0); }
  };
  const onImageClick = () => {
    if (movedRef.current) return; // a fost swipe, nu tap — nu comuta zoom-ul
    setZoomed(z => !z);
  };

  // Gestul vertical al Bottom Sheet-ului — aceeasi tehnica (tolerance + prag de comitere)
  // ca swipe-ul orizontal de decizie de mai sus, doar pe axa Y si cu doua directii
  // valide diferite dupa starea curenta (restrans -> doar in sus, extins -> doar in jos).
  const onSheetHandlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    sheetDraggingRef.current = true;
    sheetMovedRef.current = false;
    sheetStartYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSheetHandlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!sheetDraggingRef.current) return;
    const delta = e.clientY - sheetStartYRef.current;
    if (Math.abs(delta) > SWIPE_TAP_TOLERANCE) sheetMovedRef.current = true;
    // restrans: doar tras in sus (delta negativ) deschide; extins: doar tras in jos (delta pozitiv) inchide —
    // clamp-uim directia opusa la 0 ca sa nu se "intinda" vizual peste pozitia de repaus.
    const clamped = sheetExpanded ? Math.max(0, delta) : Math.min(0, delta);
    sheetDragYRef.current = clamped;
    setSheetDragY(clamped);
  };
  const endSheetDrag = () => {
    if (!sheetDraggingRef.current) return;
    sheetDraggingRef.current = false;
    if (!sheetExpanded && sheetDragYRef.current < -SHEET_DRAG_COMMIT) setSheetExpanded(true);
    else if (sheetExpanded && sheetDragYRef.current > SHEET_DRAG_COMMIT) collapseSheet();
    sheetDragYRef.current = 0;
    setSheetDragY(0);
  };
  const onSheetHandleClick = () => {
    if (sheetMovedRef.current) return; // a fost drag, nu tap — starea deja s-a decis la endSheetDrag
    if (sheetExpanded) collapseSheet();
    else setSheetExpanded(true);
  };

  return (
    <motion.div
      className="detail-fullscreen" ref={containerRef} role="dialog" aria-modal="true"
      aria-label={tr('detail.ariaLabel', { fileName: photo.fileName })} tabIndex={-1}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
    >
      {/* Scena: edge-to-edge, fundal negru, object-fit: contain — subiectul ramane centrul atentiei,
          nu un card plutitor peste un scrim (plan "Refactorizare UI/UX"). */}
      <div
        className={zoomed ? 'detail-stage zoomed' : 'detail-stage'}
        onClick={onImageClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Bug real raportat de utilizator (testare pe telefon real): pe Android, un swipe
        // dus aproape de marginea ecranului poate fi "furat" de gestul de sistem (ex. inapoi)
        // fara sa mai ajunga niciodata un eveniment pointerup/pointercancel la pagina — dragX
        // ramanea blocat la o valoare reziduala (translateX), iar poza aparea vizibil
        // decentrata (o banda neagra pe una din laturi), pana la urmatoarea decizie reala.
        // onLostPointerCapture e evenimentul DOM dedicat exact acestui caz (pierderea
        // capturii, indiferent de motiv) — plasa de siguranta pe care pointerUp/Cancel n-o
        // acopereau.
        onLostPointerCapture={endDrag}
        title={zoomed ? tr('detail.zoom.exit') : tr('detail.zoom.hint')}
      >
        {/* Bug real de accesibilitate gasit de auditul UI: `role="button"` +
            tabIndex statea pe .detail-stage, adica pe containerul care le
            CONTINE si pe celelalte 8 butoane reale (inchide, editeaza,
            colectii, inainte/inapoi, selecteaza/respinge). Un element cu rol de
            buton nu are voie sa contina alte comenzi — cititoarele de ecran il
            trateaza ca pe o singura tinta si "aplatizeaza" continutul, deci
            butoanele dinauntru deveneau greu sau deloc de gasit in modul de
            parcurgere. Rolul/tabIndex-ul/Enter-Space s-au mutat pe .swipe-surface,
            care ocupa exact aceeasi suprafata (100%/100%) dar nu contine decat
            imaginea — comportamentul la mouse/atingere ramane neschimbat
            (handlerele de pointer si de click stau in continuare pe scena). */}
        <div
          className="swipe-surface"
          role="button"
          tabIndex={0}
          aria-label={zoomed ? tr('detail.zoom.exit') : tr('detail.zoom.hint')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoomed(z => !z); }
          }}
          style={zoomed ? undefined : {
            transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
            transition: draggingRef.current ? 'none' : 'transform 0.25s var(--ease)'
          }}
        >
          {src && <AdjustedImage src={src} edits={photo.edits} alt={photo.fileName} className="detail-stage-img" />}
        </div>

        <div className="detail-stage-topbar" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <button className="detail-overlay-btn" onClick={() => openDetail(null)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
          <span className="detail-stage-filename mono">{photo.fileName}</span>
          <span className={`status-tag st-${photo.status}`}>
            {photo.status === 'selected' ? tr('workspace.status.selected') : photo.status === 'rejected' ? tr('workspace.status.rejected') : photo.status === 'candidate' ? tr('workspace.status.candidate') : tr('workspace.status.review')}
          </span>
          <button className="detail-overlay-btn" onClick={() => openEdit(photo.id)} aria-label={tr('edit.open')} title={tr('edit.open')}>
            <EditIcon />
          </button>
          <CollectionPicker photoIds={[photo.id]} iconOnly triggerClassName="detail-overlay-btn" />
        </div>

        {!zoomed && dragX > 4 && (
          <div className="swipe-badge swipe-badge-select" style={{ opacity: Math.min(1, dragX / SWIPE_COMMIT) }}>
            <CheckIcon /> {tr('detail.swipe.select')}
          </div>
        )}
        {!zoomed && dragX < -4 && (
          <div className="swipe-badge swipe-badge-reject" style={{ opacity: Math.min(1, -dragX / SWIPE_COMMIT) }}>
            <XIcon /> {tr('detail.swipe.reject')}
          </div>
        )}
        <span className="zoom-hint mono">{zoomed ? tr('detail.zoom.hintZoomed') : tr('detail.zoom.hintCollapsed')}</span>

        {!zoomed && (
          <>
            <button
              className="detail-nav-btn detail-nav-prev" onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); stepDetail(-1); }} aria-label={tr('workspace.nav.prev')}
            >
              <ChevronLeft />
            </button>
            <button
              className="detail-nav-btn detail-nav-next" onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); stepDetail(1); }} aria-label={tr('workspace.nav.next')}
            >
              <ChevronRight />
            </button>
          </>
        )}

        {/* Motivul deciziei, chiar deasupra butoanelor cu care se ia decizia.
            Vezi ScoreReason: scorul, verdictul si primele doua cauze, toate din
            date deja aflate in memorie. */}
        {!zoomed && (
          <div
            className={sheetExpanded ? 'detail-reason-row hidden' : 'detail-reason-row'}
            aria-hidden={sheetExpanded}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <ScoreReason photo={photo} onExplain={explainScore} />
          </div>
        )}

        {/* Butoane flotante flat-design (plan "Refactorizare UI/UX") — inlocuiesc butoanele
            text masive Selecteaza/Respinge; ascunse cat timp sheet-ul de metrici e extins,
            ca sa nu se suprapuna peste continutul lui. */}
        {!zoomed && (
          <div className={sheetExpanded ? 'detail-fab-row hidden' : 'detail-fab-row'} aria-hidden={sheetExpanded}>
            <button
              className="detail-fab detail-fab-reject" onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); void setStatus(photo.id, 'rejected'); stepDetail(1); }}
              aria-label={tr('workspace.action.reject')} tabIndex={sheetExpanded ? -1 : 0}
            >
              <XIcon />
            </button>
            <button
              className="detail-fab detail-fab-select" onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); void setStatus(photo.id, 'selected'); stepDetail(1); }}
              aria-label={tr('workspace.action.select')} tabIndex={sheetExpanded ? -1 : 0}
            >
              <CheckIcon />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Sheet: metrici/tab-uri/rating, ascunse implicit — deschise prin tap pe maner
          sau gest de swipe up (SHEET_DRAG_COMMIT), animate cu transform translateY + cubic-bezier. */}
      <div
        // Clasa `dragging` exista strict pentru CSS: cat timp foaia e restransa,
        // continutul ei e scos din ordinea de Tab cu `visibility: hidden` (vezi
        // styles.css — altfel Tab ajungea pe stele/file aflate sub marginea de
        // jos a ecranului). In timpul gestului de tras in sus, insa, continutul
        // chiar se vede treptat, deci acolo trebuie sa ramana vizibil pana cand
        // clasa `expanded` preia stafeta la ridicarea degetului.
        className={`detail-sheet${sheetExpanded ? ' expanded' : ''}${sheetDraggingRef.current ? ' dragging' : ''}`}
        style={sheetDraggingRef.current ? {
          transform: `translateY(calc(${sheetExpanded ? '0%' : `100% - ${SHEET_PEEK_PX}px`} + ${sheetDragY}px))`,
          transition: 'none'
        } : undefined}
      >
        <button
          className="detail-sheet-handle"
          onClick={onSheetHandleClick}
          onPointerDown={onSheetHandlePointerDown}
          onPointerMove={onSheetHandlePointerMove}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
          aria-expanded={sheetExpanded}
          aria-label={sheetExpanded ? tr('detail.sheet.collapse') : tr('detail.sheet.expand')}
        >
          <span className="detail-sheet-handle-bar" aria-hidden="true" />
          <span className="detail-sheet-peek-label mono">
            {tr('detail.sheet.peekLabel')}
            <ChevronUpIcon aria-hidden="true" />
          </span>
        </button>

        <div className="detail-sheet-content">
          <div className="detail-rating-row">
            <StarRating rating={photo.rating} onRate={n => void setRating(photo.id, n)} />
          </div>

          {/* Editarea, la vedere. Cerinta directa a utilizatorului: pana acum
              singura cale rapida spre editor era o iconita de creion, fara nume,
              in coltul din dreapta sus al antetului — nu se vedea si nu se
              intelegea. Acum sta aici, langa compararea seriei, pe acelasi rand
              de actiuni si vizibila din orice fila. */}
          <div className="detail-sheet-actions">
            <button className="ghost slim detail-edit-action" onClick={() => openEdit(photo.id)}>
              <EditIcon className="inline-icon" /> {tr('detail.editPhoto')}
            </button>
            {photo.groupId && (
              <button className="ghost slim" onClick={() => { openDetail(null); openCompare(photo.groupId!); }}>
                <LayersIcon className="inline-icon" /> {tr('detail.compareSeries')}
              </button>
            )}
          </div>

          <PhotoInfoTabs photo={photo} src={src} openTab={openTab} />
        </div>
      </div>
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
