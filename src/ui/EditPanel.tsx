import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { computeAutoAdjustments, drawAdjusted, isNeutral, NEUTRAL_ADJUSTMENTS, type EditAdjustments } from '../core/imageAdjust';
import { db, type AnalysisRecord } from '../core/db';
import { XIcon, UndoIcon, SparkleIcon, CropIcon } from './icons';
import { t } from '../i18n';

// Doar cele 10 chei numerice cu slider in UI — rotationDeg (auto-indreptare)
// tot nu are un control manual dedicat, dar `crop` acum are propriul tool
// (vezi CropBox/startCrop mai jos) — bug real raportat de utilizator: cand
// recadrarea automata a AI-ului nu era pe placul lui, singura optiune era
// Reseteaza (care anula TOATE ajustarile, nu doar crop-ul) sau sa renunte
// complet la recadrare. sharpen/noiseReduction sunt 0..100 (o singura
// directie are sens — nu exista "sharpen negativ"), clarity ramane -100..100
// ca restul (poate si inmuia contrastul local, nu doar accentua) — de-aia
// fiecare slider isi declara propriul interval, nu mai e un singur min/max
// fix pentru toate.
const SLIDERS: { key: keyof Omit<EditAdjustments, 'crop' | 'rotationDeg'>; min: number; max: number }[] = [
  { key: 'exposure', min: -100, max: 100 },
  { key: 'contrast', min: -100, max: 100 },
  { key: 'saturation', min: -100, max: 100 },
  { key: 'temperature', min: -100, max: 100 },
  { key: 'tint', min: -100, max: 100 },
  { key: 'highlights', min: -100, max: 100 },
  { key: 'shadows', min: -100, max: 100 },
  { key: 'clarity', min: -100, max: 100 },
  { key: 'sharpen', min: 0, max: 100 },
  { key: 'noiseReduction', min: 0, max: 100 }
];

type CropBox = { x: number; y: number; width: number; height: number };
type CropDragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const FULL_CROP: CropBox = { x: 0, y: 0, width: 1, height: 1 };
// Sub aceasta latime/inaltime (fractiune din cadru), o caseta ar fi prea mica
// ca sa mai poata fi apucata de handle-uri pe un ecran de telefon.
const MIN_CROP_SIZE = 0.1;
function clamp01(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Modul de editare de baza, non-destructiv (plan "modernizare cat mai pro"):
 * expunere/contrast/saturatie/temperatura/tinta/highlights/shadows, aplicate
 * live pe un canvas separat — preview-ul si originalul stocate in Dexie NU
 * sunt atinse niciodata, doar PhotoRecord.edits (core/db.ts) retine valorile,
 * ca sa poata fi resetate oricand fara pierdere de calitate.
 */
export function EditPanel() {
  const editingId = useStore(s => s.editingPhotoId);
  const setEditingId = useStore(s => s.openEdit);
  const autoApplyRequested = useStore(s => s.editAutoApplyRequested);
  const photos = useStore(s => s.photos);
  const setEditAdjustments = useStore(s => s.setEditAdjustments);
  const setNotice = useStore(s => s.setNotice);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  const photo = photos.find(p => p.id === editingId) ?? null;
  useModalFocusTrap(containerRef, !!photo);

  const [adjustments, setAdjustments] = useState<EditAdjustments>(NEUTRAL_ADJUSTMENTS);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // scorurile AI deja calculate pentru poza (acelasi AnalysisRecord afisat in
  // tab-ul "De ce acest scor") — sursa pentru butonul Auto, vezi applyAuto mai jos
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  // Distinct de `analysis === null` (care si el poate insemna "inca nu s-a incarcat"
  // SAU "chiar nu exista analiza") — necesar ca sa stim sigur cand ambele surse
  // (imagine + analiza) chiar s-au stabilizat, inainte de auto-aplicarea de mai jos
  // (vezi PhotoInfoTabs, butonul "Aplica" pe o sugestie) — altfel un auto-apply
  // declansat inainte ca analiza sa apuce sa soseasca ar folosi doar contrastul
  // (singurul semnal derivat direct din pixeli), fara expunere/recadrare/etc.
  const [analysisLoaded, setAnalysisLoaded] = useState(false);
  const autoAppliedRef = useRef(false);
  // Bug real raportat de utilizator: slidere "extrem de greu, cu lag mare".
  // Cauza — update() scria in Dexie (setEditAdjustments) la FIECARE eveniment
  // de drag, nu doar la eliberare; acel write reconstruieste intreg array-ul
  // `photos` din store (potential sute/mii de poze) la fiecare pixel de
  // miscare a unui slider, declansand recalculari in cascada peste tot ce
  // citeste `photos` (filtered/secondaryFiltered/counts). Redesenarea pe canvas
  // era deja limitata corect la un cadru (rafRef mai jos), dar persistarea nu
  // era limitata deloc. Solutie: persistarea in Dexie e amanata (debounce),
  // starea locala (adjustments) ramane instant — previzualizarea live nu
  // depinde de scrierea in DB.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistRef = useRef<{ id: string; adjustments: EditAdjustments } | null>(null);
  const flushPersist = () => {
    if (persistTimerRef.current !== null) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    const pending = pendingPersistRef.current;
    if (!pending) return;
    pendingPersistRef.current = null;
    void setEditAdjustments(pending.id, pending.adjustments);
  };
  // Nicio editare in curs nu trebuie pierduta la schimbarea pozei sau la
  // inchiderea panoului — scrie imediat orice a mai ramas in asteptare.
  useEffect(() => () => flushPersist(), []);

  /**
   * Recadrare manuala (tool nou, cerinta directa a utilizatorului): cat timp
   * `cropDraft` nu e null, panoul e in "modul crop" — canvas-ul arata cadrul
   * INTREG (vezi drawAdjusted mai jos, cropModeActive ignora adjustments.crop
   * cat timp se editeaza), cu o caseta suprapusa pe care utilizatorul o poate
   * muta/redimensiona. `cropDraft` e coordonatele TEMPORARE (draft), separate
   * de `adjustments.crop` — Salveaza scrie draftul in adjustments, Renunta il
   * arunca fara sa atinga nimic.
   */
  const [cropDraft, setCropDraft] = useState<CropBox | null>(null);
  const cropModeActive = cropDraft !== null;
  const cropDragRef = useRef<{ mode: CropDragMode; startX: number; startY: number; startBox: CropBox } | null>(null);

  useEffect(() => {
    flushPersist();
    if (!photo) return;
    setAdjustments(photo.edits ?? NEUTRAL_ADJUSTMENTS);
    setImgEl(null);
    setAnalysis(null);
    setAnalysisLoaded(false);
    autoAppliedRef.current = false;
    setCropDraft(null);
    let alive = true;
    void getCachedPreviewUrl(photo.id).then(url => {
      if (!alive || !url) return;
      const img = new Image();
      img.onload = () => { if (alive) setImgEl(img); };
      img.src = url;
    });
    void db.analyses.get(photo.id).then(a => {
      if (!alive) return;
      setAnalysis(a ?? null);
      setAnalysisLoaded(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id]);

  // Redesenare pe requestAnimationFrame — dragul unui slider poate emite multe
  // evenimente pe cadru; fara asta, un pixel-pass complet (temperatura/tinta/
  // highlights/shadows) ar rula de mai multe ori inutil pentru acelasi cadru vizual.
  //
  // Bug real raportat de utilizator: slidere tot sacadate dupa ce persistarea
  // in Dexie a fost amanata (vezi persistTimerRef mai sus) — cauza ramasa era
  // ALTA: de indata ce O SINGURA ajustare din familia highlights/shadows/
  // temperatura/tinta e diferita de 0 (foarte comun — Auto seteaza des
  // highlights), FIECARE redesenare, indiferent ce slider anume se trage
  // (inclusiv Contrast, care altfel ar fi "gratuit" prin ctx.filter), trece
  // printr-un getImageData/bucla-pe-pixel/putImageData pe TOATA rezolutia
  // preview-ului incarcat (pana la 2048px lung, vezi PREVIEW_MAX_SIDE din
  // importPipeline.ts) — cateva milioane de pixeli, la fiecare cadru, cat
  // timp utilizatorul trage un slider. RAF-ul de mai sus limiteaza CATE ORI
  // pe secunda se redeseneaza, dar nu face desenul insusi mai rapid daca
  // depaseste bugetul unui cadru. Canvas-ul de aici e doar o PREVIZUALIZARE
  // (exportul foloseste applyAdjustmentsToBlob pe blob-ul original, la
  // rezolutie completa) — nu are nevoie de rezolutia integrala a preview-ului
  // pentru feedback vizual pe un ecran de telefon.
  // 768 (nu 1024, valoarea initiala a acestui plafon) — feedback direct pe
  // device real dupa primul plafon: sliderele tot "se putea si mai rapid".
  // Trecerea de pixeli (temperatura/tinta/highlights/shadows/claritate/
  // sharpen/reducere-zgomot) scaleaza cu NUMARUL de pixeli al canvas-ului,
  // deci 768 (~44% mai putini pixeli fata de 1024) ramane vizibil suficient
  // de clar pe un ecran de telefon, dar taie proportional din costul per cadru.
  const EDIT_PREVIEW_MAX_SIDE = 768;
  // Cat timp utilizatorul editeaza manual recadrarea (cropModeActive), preview-ul
  // arata cadrul INTREG (crop: undefined), nu cel deja recadrat — caseta suprapusa
  // (vezi JSX mai jos) se pozitioneaza direct in coordonatele canvas-ului doar daca
  // acesta arata intreaga poza, altfel fractiile 0..1 ale casetei nu s-ar mai
  // potrivi cu ce se vede. Foloseste `cropModeActive` (boolean), NU `cropDraft`
  // direct, ca dependinta — altfel fiecare tick de drag al casetei (care schimba
  // identitatea obiectului cropDraft) ar redeclansa un pixel-pass complet, desi
  // imaginea de fundal nu se schimba deloc in timpul unui drag de recadrare.
  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, EDIT_PREVIEW_MAX_SIDE / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
      canvas.width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(imgEl.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      const drawn = cropModeActive ? { ...adjustments, crop: undefined } : adjustments;
      if (ctx) drawAdjusted(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height, drawn);
    });
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl, adjustments, cropModeActive]);

  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cropDraft) { setCropDraft(null); return; }
      setEditingId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, setEditingId, cropDraft]);

  /**
   * "Editor AI automat" (cerinta directa a utilizatorului): expunerea,
   * recuperarea highlights/shadows, recadrarea, indreptarea si desaturarea
   * se bazeaza pe scorurile AI DEJA calculate pentru poza (`analysis`,
   * acelasi AnalysisRecord din tab-ul "De ce acest scor") — nu o re-analiza
   * independenta, ca sa nu ajunga vreodata sa contrazica explicatia pe care
   * utilizatorul o vede deja pentru acelasi cadru (vezi core/imageAdjust.ts,
   * computeAutoAdjustments). Ruleaza pe imgEl (imaginea deja incarcata,
   * needitata), nu pe canvas-ul cu ajustari deja aplicate. Ramane complet
   * reversibil — apasarea Auto doar precompleteaza sliderele/recadrarea,
   * exact ca si cum utilizatorul le-ar fi facut singur; Reseteaza le duce
   * pe toate (inclusiv crop/rotationDeg) inapoi la neutru dintr-un tap.
   * Definit AICI (nu mai jos, langa `update`/`resetAll`) ca sa poata fi
   * apelat si din efectul de auto-aplicare de mai jos, inainte de orice
   * return conditionat — hook-urile trebuie sa ramana neconditionate.
   *
   * Confirmarea prin `setNotice` de mai jos exista dupa feedback direct pe
   * device real: o recadrare discreta (fara control manual de crop in UI)
   * putea trece complet neobservata — utilizatorul nu avea niciun semnal ca
   * "Aplica" chiar facuse ceva, mai ales cand efectul vizual era subtil.
   */
  const applyAuto = () => {
    if (!imgEl || !photo) return;
    const auto = computeAutoAdjustments(imgEl, imgEl.naturalWidth, imgEl.naturalHeight, {
      exposureScore: analysis?.exposure,
      highlightClipping: analysis?.highlightClipping,
      shadowClipping: analysis?.shadowClipping,
      faceCount: analysis?.faceCount,
      faces: analysis?.faces,
      ruleOfThirds: analysis?.ruleOfThirds,
      horizonTiltDeg: analysis?.horizonTiltDeg,
      colorHarmonyScore: analysis?.colorHarmonyScore
    });
    setAdjustments(auto);
    pendingPersistRef.current = null;
    if (persistTimerRef.current !== null) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    void setEditAdjustments(photo.id, auto);

    const applied: string[] = [];
    if (auto.exposure !== 0) applied.push(tr('edit.exposure').toLowerCase());
    if (auto.highlights !== 0) applied.push(tr('edit.highlights').toLowerCase());
    if (auto.shadows !== 0) applied.push(tr('edit.shadows').toLowerCase());
    if (auto.contrast !== 0) applied.push(tr('edit.contrast').toLowerCase());
    if (auto.saturation !== 0) applied.push(tr('edit.saturation').toLowerCase());
    if (auto.crop) applied.push(tr('edit.auto.crop'));
    if (auto.rotationDeg) applied.push(tr('edit.auto.straighten'));
    setNotice(applied.length ? tr('edit.auto.applied', { list: applied.join(', ') }) : tr('edit.auto.nothingToApply'));
  };

  // Deschidere din butonul "Aplica" al unei sugestii (PhotoInfoTabs, tab-ul
  // "De ce acest scor") — openEdit(id, { autoApply: true }) seteaza
  // editAutoApplyRequested; odata ce imaginea SI analiza (analysisLoaded) s-au
  // stabilizat, Auto se declanseaza o singura data (autoAppliedRef), fara sa
  // astepte un tap suplimentar — utilizatorul vede direct rezultatul, gata de
  // pastrat sau de Reseteaza.
  useEffect(() => {
    if (!autoApplyRequested || autoAppliedRef.current || !imgEl || !analysisLoaded || !photo) return;
    autoAppliedRef.current = true;
    applyAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApplyRequested, imgEl, analysisLoaded, photo?.id]);

  if (!photo) return null;

  const PERSIST_DEBOUNCE_MS = 400;

  const update = (key: keyof EditAdjustments, value: number) => {
    const next = { ...adjustments, [key]: value };
    setAdjustments(next);
    // starea locala (de mai sus) ramane instant, pentru previzualizarea live —
    // doar scrierea in Dexie e amanata, vezi comentariul de la persistTimerRef.
    pendingPersistRef.current = { id: photo.id, adjustments: next };
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
  };

  const resetAll = () => {
    setAdjustments(NEUTRAL_ADJUSTMENTS);
    pendingPersistRef.current = null;
    if (persistTimerRef.current !== null) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    void setEditAdjustments(photo.id, NEUTRAL_ADJUSTMENTS);
  };

  // Porneste modul de recadrare manuala, pornind de la recadrarea deja
  // existenta (auto sau manuala anterioara) daca exista una, altfel de la
  // cadrul intreg — utilizatorul rafineaza ce e deja acolo, nu reincepe de la 0.
  const startCrop = () => setCropDraft(adjustments.crop ?? FULL_CROP);
  const cancelCrop = () => { cropDragRef.current = null; setCropDraft(null); };
  const clearCropDraft = () => setCropDraft(FULL_CROP);
  const applyCrop = () => {
    if (!cropDraft) return;
    // Cadru practic intreg (utilizatorul a tras caseta inapoi la marginile
    // originale) — salveaza `undefined`, nu un obiect crop redundant, ca sa
    // ramana consistent cu isNeutral()/badge-ul "editat" din alta parte.
    const isFull = cropDraft.x <= 0.005 && cropDraft.y <= 0.005 && cropDraft.width >= 0.995 && cropDraft.height >= 0.995;
    const next = { ...adjustments, crop: isFull ? undefined : cropDraft };
    setAdjustments(next);
    pendingPersistRef.current = null;
    if (persistTimerRef.current !== null) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    void setEditAdjustments(photo.id, next);
    cropDragRef.current = null;
    setCropDraft(null);
  };

  /**
   * Drag pentru caseta de recadrare — un singur handler de pointerdown pentru
   * mutare (`move`, pe caseta insasi) SI cele 4 colturi de redimensionare
   * (`nw`/`ne`/`sw`/`se`), diferentiate prin `mode`. Foloseste Pointer Events
   * (nu mouse/touch separat) — functioneaza identic cu mouse pe desktop si cu
   * degetul pe telefon (cazul principal aici), inclusiv setPointerCapture ca
   * drag-ul sa continue chiar daca degetul/cursorul iese din caseta la mijlocul
   * gestului.
   */
  const onCropHandleDown = (mode: CropDragMode) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropDraft) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDragRef.current = { mode, startX: e.clientX, startY: e.clientY, startBox: cropDraft };
  };
  const onCropOverlayMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const b = drag.startBox;
    let next: CropBox;
    if (drag.mode === 'move') {
      next = {
        ...b,
        x: clamp01(b.x + dx, 0, 1 - b.width),
        y: clamp01(b.y + dy, 0, 1 - b.height)
      };
    } else {
      let { x, y, width, height } = b;
      if (drag.mode === 'nw' || drag.mode === 'sw') {
        const newX = clamp01(b.x + dx, 0, b.x + b.width - MIN_CROP_SIZE);
        width = b.width - (newX - b.x);
        x = newX;
      }
      if (drag.mode === 'ne' || drag.mode === 'se') {
        width = clamp01(b.width + dx, MIN_CROP_SIZE, 1 - b.x);
      }
      if (drag.mode === 'nw' || drag.mode === 'ne') {
        const newY = clamp01(b.y + dy, 0, b.y + b.height - MIN_CROP_SIZE);
        height = b.height - (newY - b.y);
        y = newY;
      }
      if (drag.mode === 'sw' || drag.mode === 'se') {
        height = clamp01(b.height + dy, MIN_CROP_SIZE, 1 - b.y);
      }
      next = { x, y, width, height };
    }
    setCropDraft(next);
  };
  const onCropOverlayUp = () => { cropDragRef.current = null; };

  return (
    <div className="edit-scrim" onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}>
      <div className="edit-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('edit.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('edit.title')}</span>
          <div className="contact-sheet-header-actions">
            {cropDraft ? (
              <>
                <button className="ghost small-btn" onClick={clearCropDraft}>{tr('edit.crop.reset')}</button>
                <button className="ghost small-btn" onClick={cancelCrop}>{tr('edit.crop.cancel')}</button>
                <button className="btn-accent small-btn" onClick={applyCrop}>{tr('edit.crop.apply')}</button>
              </>
            ) : (
              <>
                <button className="ghost small-btn edit-auto-btn" onClick={applyAuto} disabled={!imgEl}>
                  <SparkleIcon className="inline-icon" /> {tr('edit.auto')}
                </button>
                <button className="ghost small-btn" onClick={startCrop} disabled={!imgEl}>
                  <CropIcon className="inline-icon" /> {tr('edit.crop')}
                </button>
                <button className="ghost small-btn" onClick={resetAll} disabled={isNeutral(adjustments)}>
                  <UndoIcon className="inline-icon" /> {tr('edit.reset')}
                </button>
                <button className="ghost icon-btn" onClick={() => setEditingId(null)} aria-label={tr('detail.close')}>
                  <XIcon />
                </button>
              </>
            )}
          </div>
        </header>

        <div className="edit-body">
          {/* Bug real raportat de utilizator: containerul avea un aspect-ratio FIX
              (4/3 pe desktop, 16/10 — si mai landscape — pe mobil), asa ca orice
              poza portret (majoritatea pozelor facute cu telefonul tinut vertical)
              aparea minuscula, incadrata intre doua bare negre uriase. Odata ce
              poza s-a incarcat, containerul isi ia raportul EI real de aspect —
              indiferent de orientare/dimensiune, umple exact spatiul disponibil,
              fara letterboxing si fara sa "sara" de la o dimensiune presupusa la
              cea reala.
              Bug real raportat de utilizator (a doua oara): pe telefon, tot panoul
              (.edit-modal) e cel care scroleaza, nu doar lista de slidere — cand
              utilizatorul cobora ca sa ajunga la sliderele de jos (Claritate/
              Accentuare/Reducere zgomot), poza disparea complet din ecran, desi
              tocmai despre "sa vezi live corectia" e vorba. `position: sticky`
              (vezi .edit-canvas-wrap in @media (max-width:760px) din styles.css)
              tine poza fixata sus in timp ce doar lista de slidere scroleaza pe
              sub ea. */}
          <div className="edit-canvas-wrap" style={imgEl ? { aspectRatio: `${imgEl.naturalWidth} / ${imgEl.naturalHeight}` } : undefined}>
            {/* Bug real gasit de auditul QA: singurul loc din aplicatie unde poza e
                afisata fara nicio alternativa text pentru un cititor de ecran —
                DetailView/Workspace/etc au toate alt={photo.fileName}, doar canvas-ul
                de aici nu avea nimic. Canvas nu are `alt`, dar poate primi role="img"
                + aria-label, exact echivalentul semantic. */}
            <canvas ref={canvasRef} className="edit-canvas" role="img" aria-label={photo.fileName} />
            {!imgEl && <span className="card-loading edit-canvas-loading" aria-hidden="true" />}
            {cropDraft && (
              <div
                className="crop-overlay"
                onPointerMove={onCropOverlayMove}
                onPointerUp={onCropOverlayUp}
                onPointerCancel={onCropOverlayUp}
              >
                <div
                  className="crop-box"
                  style={{
                    left: `${cropDraft.x * 100}%`, top: `${cropDraft.y * 100}%`,
                    width: `${cropDraft.width * 100}%`, height: `${cropDraft.height * 100}%`
                  }}
                  onPointerDown={onCropHandleDown('move')}
                >
                  <span className="crop-handle crop-handle-nw" onPointerDown={onCropHandleDown('nw')} />
                  <span className="crop-handle crop-handle-ne" onPointerDown={onCropHandleDown('ne')} />
                  <span className="crop-handle crop-handle-sw" onPointerDown={onCropHandleDown('sw')} />
                  <span className="crop-handle crop-handle-se" onPointerDown={onCropHandleDown('se')} />
                </div>
              </div>
            )}
          </div>
          {cropDraft ? (
            <p className="edit-crop-hint">{tr('edit.crop.hint')}</p>
          ) : (
            <div className="edit-sliders">
              {SLIDERS.map(({ key, min, max }) => (
                <label key={key} className="edit-slider-row">
                  <span className="edit-slider-label" aria-hidden="true">{tr(`edit.${key}`)}</span>
                  <input
                    type="range" min={min} max={max} step={1}
                    value={adjustments[key] ?? 0}
                    onChange={e => update(key, Number(e.target.value))}
                    // Bug real gasit de auditul QA: label-ul invaluia si numele SI
                    // valoarea numerica, deci numele accesibil calculat includea
                    // ambele (ex. "Expunere 20"), iar cititorul de ecran anunta
                    // valoarea A DOUA OARA separat (nativ, la fiecare schimbare de
                    // range) — redundant. aria-label explicit foloseste DOAR numele.
                    aria-label={tr(`edit.${key}`)}
                  />
                  <span className="edit-slider-value mono" aria-hidden="true">{adjustments[key] ?? 0}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
