import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent , type ReactNode } from 'react';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore } from '../state/store';
import { buildMomentStacks, momentOf } from '../core/momentStacks';
import { useModalFocusTrap } from './useModalFocusTrap';
import {
  computeAutoAdjustments, drawAdjusted, isNeutral, NEUTRAL_ADJUSTMENTS,
  originalToCanvas, canvasToOriginal, cropRadiusScale,
  type EditAdjustments, type NumericAdjustmentKey
} from '../core/imageAdjust';
import {
  boxForAspect, moveCropBox, normalizedBoxRatio, resizeCropFree, resizeCropLocked,
  FULL_CROP, type CropBox, type CropDragMode
} from '../core/cropMath';
import { db, type AnalysisRecord } from '../core/db';
import { CurveEditor } from './CurveEditor';
import { EditSlider } from './EditSlider';
import { EditHistogram } from './EditHistogram';
import { computeHistogram, type Histogram as HistogramData } from '../core/histogram';
import { BANDS, NEUTRAL_BAND, type BandKey, type BandAdjust } from '../core/hslBands';
import { PRESETS, applyPreset } from '../core/editPresets';
import {
  CURVE_PRESETS, LINEAR_CURVE,
  type CurveChannel, type CurvePoint, type PhotoCurves
} from '../core/toneCurve';
import {
  createControlPoint, isNeutralControlPoint, MAX_CONTROL_POINTS,
  MIN_CONTROL_RADIUS, MAX_CONTROL_RADIUS, type ControlPoint
} from '../core/selectiveEdit';
import { DEFAULT_HEAL_RADIUS, MIN_HEAL_RADIUS, MAX_HEAL_RADIUS, type HealStroke } from '../core/spotHeal';
import { XIcon, UndoIcon, SparkleIcon, LayersIcon, TrashIcon, EyeIcon, SunIcon, ApertureIcon, BarChartIcon, FocusIcon, EditIcon, CropIcon } from './icons';
import { t, plural } from '../i18n';

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
/**
 * Sliderele de baza, pe grupe.
 *
 * Erau unsprezece intr-o singura lista, in ordinea in care au fost adaugate de-a
 * lungul timpului: expunere, contrast, saturatie, temperatura, tinta,
 * highlights, umbre, claritate, accentuare, zgomot, vinieta. Se puteau folosi,
 * dar nu se putea NAVIGA printre ele — cine cauta "mai cald" trecea peste
 * highlights si umbre ca sa ajunga acolo.
 *
 * Impartirea de mai jos e cea din orice editor profesionist (Lightroom, Capture
 * One, Snapseed), si nu din obisnuinta: sunt patru feluri de interventii.
 * LUMINA muta tonurile, CULOAREA muta nuantele, DETALIUL lucreaza la nivel de
 * textura, EFECTELE adauga ceva ce nu era in poza.
 */
const SLIDER_GROUPS: {
  labelKey: string;
  sliders: { key: Exclude<NumericAdjustmentKey, 'rotationDeg'>; min: number; max: number }[];
}[] = [
  {
    labelKey: 'edit.group.light',
    sliders: [
      { key: 'exposure', min: -100, max: 100 },
      { key: 'contrast', min: -100, max: 100 },
      { key: 'highlights', min: -100, max: 100 },
      { key: 'shadows', min: -100, max: 100 },
      { key: 'whites', min: -100, max: 100 },
      { key: 'blacks', min: -100, max: 100 }
    ]
  },
  {
    labelKey: 'edit.group.color',
    sliders: [
      { key: 'temperature', min: -100, max: 100 },
      { key: 'tint', min: -100, max: 100 },
      { key: 'saturation', min: -100, max: 100 }
    ]
  },
  {
    labelKey: 'edit.group.detail',
    sliders: [
      { key: 'clarity', min: -100, max: 100 },
      { key: 'sharpen', min: 0, max: 100 },
      { key: 'noiseReduction', min: 0, max: 100 }
    ]
  },
  {
    labelKey: 'edit.group.effects',
    sliders: [{ key: 'vignette', min: -100, max: 100 }]
  }
];

/**
 * Instrumentele editorului. Pana acum panoul avea o singura fata (o lista de
 * slidere) plus un mod de recadrare pornit dintr-un buton din antet — adica
 * doua feluri diferite de a intra in doua feluri diferite de editare. Acum
 * toate sunt intrari egale in aceeasi bara: expunerea, curba, punctele
 * selective, vindecarea si recadrarea sunt cinci instrumente, nu un panou si
 * patru exceptii.
 */
type EditTool = 'basic' | 'color' | 'curves' | 'selective' | 'heal' | 'crop';
/**
 * Iconita plus nume, ca in bara de unelte din Lightroom mobil si Snapseed — o
 * bara de sase cuvinte mici, fara niciun semn vizual, era greu de parcurs din
 * ochi si arata a lista de linkuri, nu a unelte.
 */
/**
 * Cat timp fara nicio schimbare inseamna "degetul s-a ridicat". 160ms: peste
 * doua cadre la 60Hz, deci nu se declanseaza intre doua evenimente de drag, dar
 * sub pragul la care ochiul ar simti o intarziere pana la imaginea clara.
 */
const INTERACTION_SETTLE_MS = 160;
/** Cat de mult se poate apropia lupa din editor. Peste 6x se vad doar pixeli. */
const MAX_EDIT_ZOOM = 6;
const DOUBLE_TAP_MS = 300;

const TOOLS: { key: EditTool; labelKey: string; icon: ReactNode }[] = [
  { key: 'basic', labelKey: 'edit.tool.basic', icon: <SunIcon /> },
  { key: 'color', labelKey: 'edit.tool.color', icon: <ApertureIcon /> },
  { key: 'curves', labelKey: 'edit.tool.curves', icon: <BarChartIcon /> },
  { key: 'selective', labelKey: 'edit.tool.selective', icon: <FocusIcon /> },
  { key: 'heal', labelKey: 'edit.tool.heal', icon: <EditIcon /> },
  { key: 'crop', labelKey: 'edit.tool.crop', icon: <CropIcon /> }
];

/** Cheia din PhotoCurves pentru fiecare canal + culoarea liniei din editor. */
/** Culoarea pastilei fiecarei game — un reper vizual, nu valoarea reala a gamei. */
const BAND_SWATCH: Record<BandKey, string> = {
  red: '#ff4d4d', orange: '#ff9a3d', yellow: '#ffe14d', green: '#4ddb6b',
  aqua: '#3ddbd0', blue: '#4d8cff', purple: '#a86bff', magenta: '#ff5ed2'
};

/** Cele trei reglaje ale unei game, in ordinea in care se folosesc. */
const BAND_SLIDERS: { key: keyof BandAdjust; labelKey: string }[] = [
  { key: 'hue', labelKey: 'edit.color.hue' },
  { key: 'saturation', labelKey: 'edit.color.saturation' },
  { key: 'luminance', labelKey: 'edit.color.luminance' }
];

/** O gama neatinsa — pentru punctul de pe pastila. */
function isNeutralBand(b: BandAdjust | undefined): boolean {
  return !b || (b.hue === 0 && b.saturation === 0 && b.luminance === 0);
}

const CURVE_CHANNEL_UI: { key: CurveChannel; labelKey: string; color: string }[] = [
  { key: 'master', labelKey: 'edit.curves.master', color: '#f2f5fa' },
  { key: 'red', labelKey: 'edit.curves.red', color: '#ff6b6b' },
  { key: 'green', labelKey: 'edit.curves.green', color: '#5fd68a' },
  { key: 'blue', labelKey: 'edit.curves.blue', color: '#6ba8ff' }
];

/** Sliderele unui punct de control selectiv. */
/** Acelasi generator ca peste tot in aplicatie (colectii, presetari) — vezi core/collections.ts. */
function newControlPointId(): string {
  return crypto.randomUUID();
}

const CONTROL_SLIDERS: { key: 'brightness' | 'contrast' | 'saturation' | 'structure'; labelKey: string }[] = [
  { key: 'brightness', labelKey: 'edit.selective.brightness' },
  { key: 'contrast', labelKey: 'edit.selective.contrast' },
  { key: 'saturation', labelKey: 'edit.selective.saturation' },
  { key: 'structure', labelKey: 'edit.selective.structure' }
];

// Presetari de raport de aspect (cerinta directa a utilizatorului: "o
// dimensiune standard... sau crop liber") — `ratio` e latime/inaltime in
// pixeli REALI (ex. 1:1, 4:5 portret, 16:9 landscape); `null` = "Liber",
// fara nicio constrangere, comportamentul original de dinainte. Restul
// matematicii de recadrare (CropBox, clamp01, normalizedBoxRatio,
// boxForAspect, resize*) traieste in core/cropMath.ts — extrasa acolo ca sa
// fie testabila direct (vezi cropMath.test.ts), fara sa randam EditPanel
// intreg sau sa simulam evenimente de pointer/canvas.
const CROP_PRESETS: { key: string; labelKey: string; ratio: number | null }[] = [
  { key: 'free', labelKey: 'edit.crop.free', ratio: null },
  { key: '1:1', labelKey: 'edit.crop.ratio.1:1', ratio: 1 },
  { key: '4:5', labelKey: 'edit.crop.ratio.4:5', ratio: 4 / 5 },
  { key: '3:4', labelKey: 'edit.crop.ratio.3:4', ratio: 3 / 4 },
  { key: '16:9', labelKey: 'edit.crop.ratio.16:9', ratio: 16 / 9 }
];

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

  // Celelalte cadre NEEDITATE din acelasi moment. Se calculeaza din pozele
  // deja in memorie (doar ora capturii si scorul), fara niciun acces la disc:
  // vezi core/momentStacks.ts, care nu se uita deloc la imagini.
  const applyEditsToMoment = useStore(s => s.applyEditsToMoment);
  const momentSiblings = useMemo(() => {
    if (!photo) return [];
    const stacks = buildMomentStacks(photos.map(p => ({
      id: p.id, capturedAt: p.capturedAt, aiScore: p.aiScore, status: p.status, groupId: p.groupId
    })));
    const moment = momentOf(stacks, photo.id);
    if (!moment) return [];
    const byId = new Map(photos.map(p => [p.id, p]));
    return moment.ids.filter(id => id !== photo.id && isNeutral(byId.get(id)?.edits));
  }, [photo, photos]);

  const applyToMoment = async () => {
    if (!photo) return;
    await applyEditsToMoment(photo.id, momentSiblings);
  };
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
  /**
   * "Se trage un slider ACUM." Raportat de utilizator: "slide-urile merg
   * sacadat, trebuie sa fie fluenta aplicatia".
   *
   * Ce costa un cadru de drag, masurat pe cod: o trecere completa pe pixeli
   * (drawAdjusted, pana la 768x768) PLUS un getImageData peste tot canvasul
   * pentru histograma live — o citire inapoi din GPU, cea mai scumpa operatie
   * din tot lantul — PLUS setLiveHistogram, care re-randeaza tot panoul (poza,
   * sliderele, uneltele) la fiecare cadru. Adica de trei ori mai mult decat
   * are nevoie ochiul ca sa vada ca se schimba ceva.
   *
   * Cat timp degetul e pe slider: previzualizarea se deseneaza la jumatate de
   * latura (un sfert din pixeli) si histograma nu se recalculeaza deloc. Cand
   * degetul se ridica — 160ms fara nicio schimbare — se redeseneaza o data la
   * calitate intreaga si histograma se pune la zi. Rezultatul afisat e acelasi;
   * doar drumul pana la el e de patru ori mai scurt.
   */
  const [interacting, setInteracting] = useState(false);
  const interactingRef = useRef(false);
  const interactEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markInteracting = () => {
    if (!interactingRef.current) {
      interactingRef.current = true;
      setInteracting(true);
    }
    if (interactEndTimerRef.current !== null) clearTimeout(interactEndTimerRef.current);
    interactEndTimerRef.current = setTimeout(() => {
      interactEndTimerRef.current = null;
      interactingRef.current = false;
      setInteracting(false);
    }, INTERACTION_SETTLE_MS);
  };
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
  // `flushPersist` lipseste intentionat din dependinte: e o inchidere noua
  // la fiecare randare, dar tot ce citeste/scrie sunt refs (persistTimerRef/
  // pendingPersistRef, mereu proaspete indiferent cand a fost creata
  // inchiderea) si `setEditAdjustments` (actiune stabila din Zustand) — deci
  // versiunea capturata la montare se comporta identic cu ultima versiune.
  // Cu deps reale (empty array), efectul ruleaza o singura data la montare/
  // demontare, exact ce se doreste — cu `flushPersist` in deps, s-ar
  // reinregistra la fiecare randare, fara niciun beneficiu real.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushPersist(), []);
  useEffect(() => () => { if (interactEndTimerRef.current !== null) clearTimeout(interactEndTimerRef.current); }, []);

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
  // null = "Liber" (fara nicio constrangere de raport) — vezi CROP_PRESETS.
  // Cat timp e setat, redimensionarea din colturi (onCropOverlayMove mai jos)
  // pastreaza raportul, in loc de comportamentul liber implicit.
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const cropModeActive = cropDraft !== null;

  const [tool, setTool] = useState<EditTool>('basic');
  const [curveChannel, setCurveChannel] = useState<CurveChannel>('master');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [healRadius, setHealRadius] = useState(DEFAULT_HEAL_RADIUS);
  // Tusa in curs de desenare — traieste separat de `adjustments.heal` pana la
  // ridicarea degetului: altfel fiecare pixel de miscare ar declansa o
  // vindecare completa (cautare de petic inclusa) pe imaginea intreaga.
  const [drawingStroke, setDrawingStroke] = useState<{ x: number; y: number }[] | null>(null);
  const healPointerRef = useRef<number | null>(null);
  const pointDragRef = useRef<string | null>(null);
  // Histograma luminantei, calculata O DATA per poza, pe o versiune mica —
  // fundalul editorului de curbe. Vezi CurveEditor.
  const [histogram, setHistogram] = useState<Uint32Array | undefined>(undefined);
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
    setCropAspect(null);
    setTool('basic');
    setActivePreset(null);
    setCurveChannel('master');
    setSelectedPointId(null);
    setDrawingStroke(null);
    setHistogram(undefined);
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

  /**
   * Histograma luminantei — fundalul editorului de curbe. Se calculeaza o
   * singura data per poza, pe o versiune mica (128px): la 256 de galeti,
   * forma histogramei nu se schimba vizibil intre 128px si rezolutia intreaga,
   * dar costul scade de zeci de ori.
   */
  useEffect(() => {
    if (!imgEl || typeof document === 'undefined') return;
    const side = 128;
    const scale = Math.min(1, side / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(1, Math.round(imgEl.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(imgEl, 0, 0, w, h);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return; // canvas "murdarit" (imagine din alta origine) — histograma e optionala
    }
    const hist = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      hist[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++;
    }
    setHistogram(hist);
  }, [imgEl]);

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
  /** Latura previzualizarii cat timp degetul e pe un slider — un sfert din pixeli. */
  const EDIT_PREVIEW_DRAG_SIDE = 384;
  /** Un esantion din opt: histograma e o silueta, nu o numaratoare exacta. */
  const HISTOGRAM_STRIDE = 8;
  /**
   * Tine apasat = vezi poza nemodificata. Gestul cel mai folosit din orice
   * editor, si singurul mod onest de a raspunde la "am imbunatatit-o, sau doar
   * am schimbat-o?". Nu e o unealta si nu merita un mod: e o apasare.
   *
   * Se implementeaza randand NEUTRAL_ADJUSTMENTS pe acelasi canvas, nu punand a
   * doua imagine peste — asa comparatia e intre exact aceiasi pixeli, trecuti
   * sau nu prin lantul de ajustari.
   */
  const [showingBefore, setShowingBefore] = useState(false);

  /**
   * Histograma LIVE a previzualizarii — distincta de `histogram` de mai sus,
   * care e fundalul editorului de curbe. Nu sunt acelasi lucru si nu se pot
   * uni: aceea are 256 de galeti pentru ca trebuie sa se alinieze cu axa
   * curbei, si arata SURSA (curbele se aplica peste ea); asta are 64, arata
   * rezultatul CU ajustari, si se recalculeaza la fiecare cadru.
   *
   * Se calculeaza din canvas-ul deja desenat, in aceeasi requestAnimationFrame,
   * deci nu costa nicio trecere in plus peste imagine. Cand tii apasat pe
   * "originalul", arata originalul: comparatia e completa, nu doar vizuala.
   */
  const [liveHistogram, setLiveHistogram] = useState<HistogramData | null>(null);
  /** Gama de culoare pe care se lucreaza acum in unealta de culoare. */
  const [band, setBand] = useState<BandKey>('red');
  /**
   * Stilul apasat ultima data — doar pentru a-l arata apasat. NU se persista:
   * de indata ce misti un slider, ajustarile nu mai sunt ale stilului, iar a
   * lasa pastila aprinsa ar fi o afirmatie falsa.
   */
  const [activePreset, setActivePreset] = useState<string | null>(null);

  /**
   * Zoom cu doua degete pe fotografie (cerinta directa: "cu posibilitati de
   * zoom in-out cu degetele"). Doua degete maresc si plimba, UN deget ramane
   * al uneltei active — asa retusul, punctele de control si caseta de decupare
   * continua sa functioneze exact ca inainte, si nu trebuie ales intre "pot
   * apropia" si "pot lucra".
   *
   * Transformarea se pune pe INVELISUL pozei, nu pe canvas: inauntru mai stau
   * caseta de decupare, punctele de control si urmele de retus, si toate
   * trebuie sa se miste odata cu imaginea. Iar fiindca getBoundingClientRect()
   * include transformarile, matematica de coordonate a uneltelor (raport intre
   * pozitia degetului si dreptunghiul canvasului) ramane corecta la orice zoom,
   * fara nicio linie schimbata acolo.
   *
   * Zoom-ul e doar o lupa: nu intra in ajustari si nu se salveaza nicaieri.
   */
  const [zoom, setZoom] = useState(1);
  const [zoomPan, setZoomPan] = useState({ x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; pan: { x: number; y: number } } | null>(null);
  const lastTapRef = useRef(0);

  const pinchCenter = () => {
    const pts = [...pointersRef.current.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  };
  const pinchDistance = () => {
    const pts = [...pointersRef.current.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onZoomPointerDown = (e: ReactPointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const c = pinchCenter();
      pinchRef.current = { dist: pinchDistance(), zoom, cx: c.x, cy: c.y, pan: zoomPan };
    }
  };
  const onZoomPointerMove = (e: ReactPointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (!pinch || pointersRef.current.size !== 2) return;
    e.preventDefault();
    const next = Math.max(1, Math.min(MAX_EDIT_ZOOM, (pinchDistance() / pinch.dist) * pinch.zoom));
    const c = pinchCenter();
    setZoom(next);
    // Plimbarea urmeaza centrul dintre degete, impartita la zoom: o miscare de
    // X pixeli pe ecran trebuie sa deplaseze imaginea cu X pixeli, indiferent
    // cat de mult e marita (transformarea scaleaza si translatia).
    setZoomPan(next <= 1 ? { x: 0, y: 0 } : {
      x: pinch.pan.x + (c.x - pinch.cx) / next,
      y: pinch.pan.y + (c.y - pinch.cy) / next
    });
  };
  const endZoomPointer = (e: ReactPointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };
  /** Dublu-tap = inapoi la incadrarea intreaga, gestul asteptat in orice vizualizator. */
  const onZoomTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS && zoom !== 1) {
      setZoom(1);
      setZoomPan({ x: 0, y: 0 });
    }
    lastTapRef.current = now;
  };
  // O poza noua sau o unealta noua incepe de la incadrarea intreaga.
  useEffect(() => { setZoom(1); setZoomPan({ x: 0, y: 0 }); }, [photo?.id, tool]);

  // Cat timp utilizatorul editeaza manual recadrarea (cropModeActive), preview-ul
  // arata cadrul INTREG (crop: undefined), nu cel deja recadrat — caseta suprapusa
  // (vezi JSX mai jos) se pozitioneaza direct in coordonatele canvas-ului doar daca
  // acesta arata intreaga poza, altfel fractiile 0..1 ale casetei nu s-ar mai
  // potrivi cu ce se vede. Foloseste `cropModeActive` (boolean), NU `cropDraft`
  // direct, ca dependinta — altfel fiecare tick de drag al casetei (care schimba
  // identitatea obiectului cropDraft) ar redeclansa un pixel-pass complet, desi
  // imaginea de fundal nu se schimba deloc in timpul unui drag de recadrare.
  /**
   * Deseneaza previzualizarea din ajustarile PRIMITE, nu din starea React.
   * Extrasa din efect ca sa poata fi chemata si direct din miscarea degetului
   * pe slider (vezi liveUpdate) — acolo tocmai drumul prin React era ce facea
   * imaginea sa sara.
   */
  const paint = (adj: EditAdjustments, lowRes: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    const maxSide = lowRes ? EDIT_PREVIEW_DRAG_SIDE : EDIT_PREVIEW_MAX_SIDE;
    const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    canvas.width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(imgEl.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const base = showingBefore
      ? { ...NEUTRAL_ADJUSTMENTS, crop: adj.crop, rotationDeg: adj.rotationDeg }
      : adj;
    const drawn = cropModeActive ? { ...base, crop: undefined } : base;
    drawAdjusted(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height, drawn);
    // Histograma NU se recalculeaza in timpul tragerii: getImageData peste tot
    // canvasul e cea mai scumpa operatie din cadru, iar setarea starii ar
    // re-randa tot panoul. Se pune la zi cand degetul se opreste.
    if (lowRes) return;
    try {
      setLiveHistogram(computeHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height), HISTOGRAM_STRIDE));
    } catch {
      // canvas "murdarit" de o imagine din alta origine — histograma dispare,
      // editarea merge mai departe
      setLiveHistogram(null);
    }
  };

  /**
   * Miscarea degetului pe un slider: valoarea NU urca in starea panoului (ar
   * re-randa tot), doar se tine intr-un ref si se deseneaza. Starea reala se
   * scrie o singura data, la ridicarea degetului (vezi EditSlider.onLive).
   */
  const liveAdjustRef = useRef<EditAdjustments | null>(null);
  const liveUpdate = (key: NumericAdjustmentKey, value: number) => {
    markInteracting();
    setActivePreset(null);
    const next = { ...(liveAdjustRef.current ?? adjustments), [key]: value };
    liveAdjustRef.current = next;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; paint(next, true); });
  };

  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    // Ajustarile tocmai s-au asezat in stare — reperul live nu mai are ce pastra.
    liveAdjustRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxSide = interacting ? EDIT_PREVIEW_DRAG_SIDE : EDIT_PREVIEW_MAX_SIDE;
      const scale = Math.min(1, maxSide / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
      canvas.width = Math.max(1, Math.round(imgEl.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(imgEl.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      const base = showingBefore ? { ...NEUTRAL_ADJUSTMENTS, crop: adjustments.crop, rotationDeg: adjustments.rotationDeg } : adjustments;
      const drawn = cropModeActive ? { ...base, crop: undefined } : base;
      if (ctx) {
        drawAdjusted(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height, drawn);
        // Histograma NU se recalculeaza in timpul tragerii: getImageData peste
        // tot canvasul e cea mai scumpa operatie din cadru, iar setarea starii
        // ar re-randa tot panoul. Se pune la zi cand degetul se opreste.
        if (!interacting) {
          try {
            setLiveHistogram(computeHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height), HISTOGRAM_STRIDE));
          } catch {
            // canvas "murdarit" de o imagine din alta origine — histograma
            // dispare, editarea merge mai departe
            setLiveHistogram(null);
          }
        }
      }
    });
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [imgEl, adjustments, cropModeActive, showingBefore, interacting]);

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
      colorHarmonyScore: analysis?.colorHarmonyScore,
      goldenHourDetected: analysis?.goldenHourDetected
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
    // Corectiile noi trebuie sa apara si in mesaj — altfel Auto face mai mult
    // decat spune, si utilizatorul nu stie ce sa reglese daca nu-i place ceva.
    if ((auto.temperature ?? 0) !== 0 || (auto.tint ?? 0) !== 0) applied.push(tr('edit.auto.whiteBalance'));
    if ((auto.whites ?? 0) !== 0 || (auto.blacks ?? 0) !== 0) applied.push(tr('edit.auto.levels'));
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

  /**
   * Singurul loc prin care trec TOATE modificarile, indiferent de instrument.
   * Starea locala se schimba instant (previzualizarea nu asteapta nimic), doar
   * scrierea in Dexie e amanata — vezi comentariul de la persistTimerRef.
   */
  const commit = (next: EditAdjustments) => {
    markInteracting();
    setAdjustments(next);
    pendingPersistRef.current = { id: photo.id, adjustments: next };
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
  };

  const update = (key: NumericAdjustmentKey, value: number) => {
    setActivePreset(null);
    commit({ ...adjustments, [key]: value });
  };
  /** Un singur reglaj dintr-o singura gama de culoare — vezi core/hslBands.ts. */
  const updateBand = (key: BandKey, field: keyof BandAdjust, value: number) => commit({
    ...adjustments,
    hsl: { ...adjustments.hsl, [key]: { ...NEUTRAL_BAND, ...adjustments.hsl?.[key], [field]: value } }
  });

  // --- curbe ---
  const curves: PhotoCurves = adjustments.curves ?? {};
  const currentCurve: CurvePoint[] = curves[curveChannel] ?? LINEAR_CURVE;
  const setCurve = (points: CurvePoint[]) => commit({ ...adjustments, curves: { ...curves, [curveChannel]: points } });
  const applyCurvePreset = (preset: PhotoCurves) => {
    // Presetarea inlocuieste TOATE canalele, nu doar cel afisat: altfel
    // "cinematic" (care coloreaza umbrele pe rosu si albastru) ar lasa in urma
    // canalele unei presetari anterioare si ar da un amestec pe care nu l-a
    // cerut nimeni. Punctele raman editabile dupa aceea.
    const empty = Object.keys(preset).length === 0;
    commit({ ...adjustments, curves: empty ? undefined : preset });
  };

  // --- puncte de control selective ---
  const controlPoints: ControlPoint[] = adjustments.controlPoints ?? [];
  const selectedPoint = controlPoints.find(p => p.id === selectedPointId) ?? null;
  const setControlPoints = (points: ControlPoint[]) =>
    commit({ ...adjustments, controlPoints: points.length ? points : undefined });
  const updateSelectedPoint = (key: keyof ControlPoint, value: number) => {
    if (!selectedPoint) return;
    setControlPoints(controlPoints.map(p => (p.id === selectedPoint.id ? { ...p, [key]: value } : p)));
  };
  const removeSelectedPoint = () => {
    if (!selectedPoint) return;
    setControlPoints(controlPoints.filter(p => p.id !== selectedPoint.id));
    setSelectedPointId(null);
  };

  // --- vindecare ---
  const healStrokes: HealStroke[] = adjustments.heal ?? [];
  const undoLastHeal = () => {
    const rest = healStrokes.slice(0, -1);
    commit({ ...adjustments, heal: rest.length ? rest : undefined });
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
  // Porneste mereu pe "Liber" (cropAspect=null) — un raport fix e o alegere
  // explicita per sesiune de recadrare, nu ceva retinut intre poze.
  const startCrop = () => { setCropAspect(null); setCropDraft(adjustments.crop ?? FULL_CROP); };
  const cancelCrop = () => { cropDragRef.current = null; setCropDraft(null); };
  const leaveCrop = () => { cancelCrop(); setTool('basic'); };
  const clearCropDraft = () => { setCropAspect(null); setCropDraft(FULL_CROP); };
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
    setTool('basic');
  };

  // Selectarea unei presetari (1:1/4:5/3:4/16:9) re-centreaza imediat caseta
  // pe raportul ales (vezi boxForAspect/normalizedBoxRatio) — utilizatorul
  // vede pe loc rezultatul, nu doar o "blocare" tacuta a raportului pentru
  // urmatorul drag. "Liber" (ratio null) doar deblocheaza constrangerea,
  // fara sa schimbe caseta curenta.
  const applyCropPreset = (ratio: number | null) => {
    setCropAspect(ratio);
    if (ratio === null || !imgEl || !cropDraft) return;
    const normR = normalizedBoxRatio(ratio, imgEl.naturalWidth, imgEl.naturalHeight);
    const cx = cropDraft.x + cropDraft.width / 2;
    const cy = cropDraft.y + cropDraft.height / 2;
    setCropDraft(boxForAspect(normR, cx, cy));
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
      next = moveCropBox(b, dx, dy);
    } else if (cropAspect !== null && imgEl) {
      const normR = normalizedBoxRatio(cropAspect, imgEl.naturalWidth, imgEl.naturalHeight);
      next = resizeCropLocked(b, drag.mode, dx, dy, normR);
    } else {
      next = resizeCropFree(b, drag.mode, dx, dy);
    }
    setCropDraft(next);
  };
  const onCropOverlayUp = () => { cropDragRef.current = null; };

  /**
   * Coordonatele unei atingeri, in DOUA sisteme deodata: cele ale canvas-ului
   * (pentru desenat pe ecran) si cele ale cadrului intreg (pentru memorat).
   * Vezi canvasToOriginal din core/imageAdjust.ts pentru de ce sunt doua.
   */
  const overlayCoords = (e: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    return { canvas: { x: cx, y: cy }, original: canvasToOriginal(cx, cy, adjustments, canvas.width, canvas.height) };
  };

  /** Pozitia pe ecran a unui punct memorat in cadrul intreg, in procente. */
  const pointScreenPos = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const c = originalToCanvas(x, y, adjustments, canvas?.width ?? 1, canvas?.height ?? 1);
    return { left: `${c.x * 100}%`, top: `${c.y * 100}%` };
  };

  /**
   * Diametrul pe ecran al unui cerc (punct de control sau pensula), exprimat
   * separat pe latime si pe inaltime. Doua procente diferite pentru acelasi
   * cerc pentru ca razele sunt fractii din latura MARE a pozei, iar containerul
   * are raportul pozei — un singur procent ar da o elipsa pe orice cadru care
   * nu e patrat.
   */
  const circleSize = (radius: number) => {
    const w = imgEl?.naturalWidth ?? 1, h = imgEl?.naturalHeight ?? 1;
    const maxSide = Math.max(w, h);
    const scaled = radius * cropRadiusScale(adjustments);
    return { width: `${2 * scaled * (maxSide / w) * 100}%`, height: `${2 * scaled * (maxSide / h) * 100}%` };
  };

  /** Cat de aproape (in coordonate de canvas) trebuie sa fie degetul de un punct ca sa il apuce, nu sa creeze altul. */
  const POINT_HIT = 0.06;

  const onSelectiveDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pos = overlayCoords(e);
    if (!pos) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    let closest: { id: string; d: number } | null = null;
    for (const p of controlPoints) {
      const c = originalToCanvas(p.x, p.y, adjustments, canvas?.width ?? 1, canvas?.height ?? 1);
      const d = Math.hypot(c.x - pos.canvas.x, c.y - pos.canvas.y);
      if (d <= POINT_HIT && (!closest || d < closest.d)) closest = { id: p.id, d };
    }
    if (closest) {
      setSelectedPointId(closest.id);
      pointDragRef.current = closest.id;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (controlPoints.length >= MAX_CONTROL_POINTS) {
      setNotice(tr('edit.selective.limit', { count: MAX_CONTROL_POINTS }));
      return;
    }
    const point = createControlPoint(pos.original.x, pos.original.y, newControlPointId());
    setControlPoints([...controlPoints, point]);
    setSelectedPointId(point.id);
  };

  const onSelectiveMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const id = pointDragRef.current;
    if (!id) return;
    const pos = overlayCoords(e);
    if (!pos) return;
    setControlPoints(controlPoints.map(p => (p.id === id ? { ...p, x: pos.original.x, y: pos.original.y } : p)));
  };

  const onSelectiveUp = () => { pointDragRef.current = null; };

  /**
   * Vindecarea: tusa se aduna cat timp degetul e pe ecran si se APLICA abia la
   * ridicare. Motivul e direct — o vindecare inseamna cautarea unui petic
   * potrivit; facuta la fiecare pixel de miscare, ar bloca degetul. Cat timp
   * se deseneaza, se vede doar urma pensulei.
   */
  const onHealDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pos = overlayCoords(e);
    if (!pos) return;
    e.preventDefault();
    healPointerRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawingStroke([pos.original]);
  };

  const onHealMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (healPointerRef.current !== e.pointerId) return;
    const pos = overlayCoords(e);
    if (!pos) return;
    setDrawingStroke(prev => {
      if (!prev) return prev;
      const last = prev[prev.length - 1];
      // un punct la fiecare sfert de raza: destul ca urma sa fie continua, dar
      // fara sa umplem tusa cu sute de cercuri suprapuse
      if (Math.hypot(pos.original.x - last.x, pos.original.y - last.y) < healRadius / 4) return prev;
      return [...prev, pos.original];
    });
  };

  const onHealUp = () => {
    healPointerRef.current = null;
    const stroke = drawingStroke;
    setDrawingStroke(null);
    if (!stroke?.length) return;
    commit({ ...adjustments, heal: [...healStrokes, { points: stroke, radius: healRadius }] });
  };

  /**
   * Intrarea si iesirea din instrumentul de recadrare. Recadrarea are stare
   * proprie (caseta draft), deci nu poate fi doar "inca un panou": schimbarea
   * instrumentului o porneste, iar parasirea lui o anuleaza — altfel o caseta
   * pe jumatate trasa ar ramane atarnata cand utilizatorul trece la curbe.
   */
  const selectTool = (next: EditTool) => {
    if (next === tool) return;
    if (tool === 'crop') cancelCrop();
    if (tool === 'heal') { setDrawingStroke(null); healPointerRef.current = null; }
    if (next === 'crop') startCrop();
    setTool(next);
  };


  return (
    <div className="edit-scrim" onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}>
      <div className="edit-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('edit.title')} tabIndex={-1}>
        {/* Antetul are acum UN singur lucru pe fiecare parte: numele panoului
            la stanga, inchiderea la dreapta. Feedback direct de pe telefon:
            butoanele se rupeau pe doua randuri inegale, iar X-ul ajungea pe al
            doilea rand, alta pozitie de fiecare data. Actiunile au coborat pe
            randul lor, in coloane egale — vezi .edit-actions. */}
        {/* UN SINGUR rand de sus, nu doua. Raportat de utilizator dupa testare pe
            telefon ("nu se vede nimic, nu ai cum sa lucrezi asa"): antetul cu
            titlu plus randul de actiuni mancau impreuna ~130px, randul de
            unelte se rupea pe doua randuri, iar din poza mai ramanea o treime
            de ecran. Acum sus e o bara subtire (inchide · titlu · Auto ·
            Reseteaza), poza ia TOT restul, iar controalele stau jos, la deget. */}
        <header className="edit-topbar">
          <button className="ghost icon-btn" onClick={() => setEditingId(null)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
          <span className="edit-topbar-title">{tr(cropDraft ? 'edit.crop' : 'edit.title')}</span>
          <div className="edit-topbar-actions">
            {cropDraft ? (
              <>
                <button className="ghost small-btn" onClick={leaveCrop}>{tr('edit.crop.cancel')}</button>
                <button className="btn-accent small-btn" onClick={applyCrop}>{tr('edit.crop.apply')}</button>
              </>
            ) : (
              <>
                <button className="ghost small-btn edit-auto-btn" onClick={applyAuto} disabled={!imgEl}>
                  <SparkleIcon className="inline-icon" /> {tr('edit.auto')}
                </button>
                <button
                  className="ghost icon-btn edit-topbar-reset"
                  onClick={resetAll}
                  disabled={isNeutral(adjustments)}
                  aria-label={tr('edit.reset')}
                  title={tr('edit.reset')}
                >
                  <UndoIcon />
                </button>
              </>
            )}
          </div>
        </header>

        <div
          className="edit-body"
          // Bug real raportat de utilizator: pe mobil, poza (centrata, latime
          // derivata din aspect-ratio + plafonul de inaltime, vezi mai jos)
          // ajungea vizibil mai ingusta decat grila de slidere de dedesubt
          // (care ramanea intinsa pe toata latimea coloanei) — un aspect
          // inconsistent. Raportul real al pozei e disponibil DOAR aici (din
          // imgEl, incarcat in JS), nu si in CSS — expus ca proprietate CSS
          // custom pe .edit-body (parintele comun al pozei SI sliderelor), ca
          // .edit-sliders/.edit-crop-panel sa poata calcula ACEEASI latime
          // maxima (44vh * raport) ca .edit-canvas-wrap, prin CSS pur, fara sa
          // duplice logica in JS.
          style={imgEl ? ({ '--photo-aspect': imgEl.naturalWidth / imgEl.naturalHeight } as CSSProperties) : undefined}
        >
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
          {/* Scena: tot spatiul dintre bara de sus si doc, cu fotografia centrata
              in el. Fara acest invelis, doc-ul ramanea agatat sub poza si sub el
              se casca un gol de ~130px pana la marginea ecranului. */}
          <div className="edit-stage-area">
          <div
            className={cropDraft ? 'edit-canvas-wrap cropping' : 'edit-canvas-wrap'}
            style={{
              ...(imgEl ? { aspectRatio: `${imgEl.naturalWidth} / ${imgEl.naturalHeight}` } : {}),
              ...(zoom !== 1
                ? { transform: `scale(${zoom}) translate(${zoomPan.x}px, ${zoomPan.y}px)` }
                : {})
            }}
            onPointerDown={onZoomPointerDown}
            onPointerMove={onZoomPointerMove}
            onPointerUp={endZoomPointer}
            onPointerCancel={endZoomPointer}
            onClick={onZoomTap}
          >
            {/* Bug real gasit de auditul QA: singurul loc din aplicatie unde poza e
                afisata fara nicio alternativa text pentru un cititor de ecran —
                DetailView/Workspace/etc au toate alt={photo.fileName}, doar canvas-ul
                de aici nu avea nimic. Canvas nu are `alt`, dar poate primi role="img"
                + aria-label, exact echivalentul semantic. */}
            <canvas ref={canvasRef} className="edit-canvas" role="img" aria-label={photo.fileName} />
            {!imgEl && <span className="card-loading edit-canvas-loading" aria-hidden="true" />}
            {/* Tine apasat = poza nemodificata. Apare doar cand chiar exista ce
                compara; pe o poza neatinsa ar fi un buton care nu face nimic.
                Ascuns in modul de recadrare: acolo canvas-ul arata oricum cadrul
                intreg, deci comparatia n-ar mai fi cu ce vede omul.
                `onPointerLeave`/`onPointerCancel` pe langa `onPointerUp`: degetul
                poate iesi din buton fara sa se ridice, si atunci poza ar fi ramas
                blocata pe "inainte". */}
            {!isNeutral(adjustments) && !cropModeActive && (
              <button
                type="button"
                className={showingBefore ? 'edit-before-btn holding' : 'edit-before-btn'}
                aria-label={tr('edit.before')}
                aria-pressed={showingBefore}
                onPointerDown={() => setShowingBefore(true)}
                onPointerUp={() => setShowingBefore(false)}
                onPointerLeave={() => setShowingBefore(false)}
                onPointerCancel={() => setShowingBefore(false)}
                // Tastatura nu are "tine apasat": acolo devine un comutator.
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowingBefore(v => !v); } }}
              >
                <EyeIcon aria-hidden="true" />
                <span>{showingBefore ? tr('edit.before.showing') : tr('edit.before')}</span>
              </button>
            )}
            {cropDraft && (
              /* Bug real raportat de utilizator: handle-urile de colt erau abia
                 apucabile — stateau exact pe marginea lui .edit-canvas-wrap, care
                 avea overflow:hidden (pentru coltul rotunjit al preview-ului),
                 asa ca jumatate din cercul fiecarui handle era pur si simplu
                 DECUPATA acolo unde caseta ajungea la marginea cadrului (foarte
                 comun — multe recadrari ating cel putin o margine). `.cropping`
                 (mai sus) trece wrap-ul pe overflow:visible cat timp se editeaza,
                 iar masca de intunecare nu mai foloseste trucul cu box-shadow
                 (care avea nevoie de overflow:hidden ca sa se decupeze singur),
                 ci 4 dreptunghiuri separate — vezi .crop-mask mai jos. */
              <div
                className="crop-overlay"
                onPointerMove={onCropOverlayMove}
                onPointerUp={onCropOverlayUp}
                onPointerCancel={onCropOverlayUp}
              >
                <div className="crop-mask" style={{ left: 0, top: 0, right: 0, height: `${cropDraft.y * 100}%` }} />
                <div className="crop-mask" style={{ left: 0, top: `${(cropDraft.y + cropDraft.height) * 100}%`, right: 0, bottom: 0 }} />
                <div className="crop-mask" style={{ left: 0, top: `${cropDraft.y * 100}%`, width: `${cropDraft.x * 100}%`, height: `${cropDraft.height * 100}%` }} />
                <div className="crop-mask" style={{ left: `${(cropDraft.x + cropDraft.width) * 100}%`, top: `${cropDraft.y * 100}%`, right: 0, height: `${cropDraft.height * 100}%` }} />
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
            {tool === 'selective' && imgEl && (
              <div
                className="selective-overlay"
                onPointerDown={onSelectiveDown}
                onPointerMove={onSelectiveMove}
                onPointerUp={onSelectiveUp}
                onPointerCancel={onSelectiveUp}
              >
                {controlPoints.map(p => {
                  const pos = pointScreenPos(p.x, p.y);
                  return (
                    <div key={p.id}>
                      {/* Conturul arata CAT DE DEPARTE ajunge punctul. Fara el,
                          raza e un numar abstract intr-un slider si nimeni nu
                          poate ghici ce anume atinge corectia. */}
                      <span
                        className={p.id === selectedPointId ? 'selective-ring active' : 'selective-ring'}
                        style={{ ...pos, ...circleSize(p.radius) }}
                        aria-hidden="true"
                      />
                      <span
                        className={
                          p.id === selectedPointId ? 'selective-dot active'
                            : isNeutralControlPoint(p) ? 'selective-dot empty' : 'selective-dot'
                        }
                        style={pos}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {tool === 'heal' && imgEl && (
              <div
                className="heal-overlay"
                onPointerDown={onHealDown}
                onPointerMove={onHealMove}
                onPointerUp={onHealUp}
                onPointerCancel={onHealUp}
              >
                {drawingStroke?.map((p, i) => (
                  <span
                    key={i}
                    className="heal-dab"
                    style={{ ...pointScreenPos(p.x, p.y), ...circleSize(healRadius) }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
          </div>
          </div>

          {/* Doc-ul de jos, tiparul din Lightroom/Snapseed/Photoshop mobil:
              controalele uneltei active si randul de unelte stau intr-o cutie
              cu inaltime PROPRIE, lipita de marginea de jos. Inainte erau frati
              directi ai fotografiei intr-o singura coloana, deci cand continutul
              crestea (un panou mai lung, randul "Aplica la inca N") impingea
              randul de unelte in afara ecranului — raportat de utilizator:
              "nu am acces la butoane nici sus nici jos". */}
          <div className="edit-dock">
          {tool === 'crop' && cropDraft && (
            <div className="edit-crop-panel">
              <div className="edit-crop-presets" role="group" aria-label={tr('edit.crop')}>
                {CROP_PRESETS.map(({ key, labelKey, ratio }) => (
                  <button
                    key={key}
                    type="button"
                    className={cropAspect === ratio ? 'chip active' : 'chip'}
                    onClick={() => applyCropPreset(ratio)}
                  >
                    {tr(labelKey)}
                  </button>
                ))}
              </div>
              <p className="edit-crop-hint">{tr('edit.crop.hint')}</p>
            </div>
          )}

          {liveHistogram && tool !== 'crop' && <EditHistogram data={liveHistogram} locale={locale} />}

          {/* Stilurile stau deasupra sliderelor, nu intr-o unealta separata: sunt
              un PUNCT DE PLECARE pentru reglajul de dedesubt, nu o alternativa
              la el. Vezi core/editPresets.ts pentru ce atinge fiecare — si ce
              nu atinge niciunul (decuparea, indreptarea, vindecarea). */}
          {tool === 'basic' && (
            <div className="edit-presets" role="group" aria-label={tr('edit.presets')}>
              {PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  className={activePreset === preset.key ? 'edit-preset active' : 'edit-preset'}
                  onClick={() => { setActivePreset(preset.key); commit(applyPreset(adjustments, preset)); }}
                  aria-pressed={activePreset === preset.key}
                >
                  {tr(`edit.preset.${preset.key}`)}
                </button>
              ))}
            </div>
          )}

          {tool === 'basic' && (
            <div className="edit-sliders">
              {SLIDER_GROUPS.map(({ labelKey, sliders }) => (
                <div className="edit-slider-group" key={labelKey}>
                  <span className="edit-slider-group-head mono">{tr(labelKey)}</span>
                  {sliders.map(({ key, min, max }) => (
                    <EditSlider
                      key={key}
                      label={tr(`edit.${key}`)}
                      value={adjustments[key] ?? 0}
                      min={min} max={max}
                      // Toate ajustarile de baza pornesc de la 0 (vezi
                      // NEUTRAL_ADJUSTMENTS), deci acolo se si intorc.
                      neutral={0}
                      onChange={v => update(key, v)}
                      onLive={v => liveUpdate(key, v)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {tool === 'color' && (
            <div className="edit-tool-panel">
              {/* Gamele se aleg dintr-un rand de pastile colorate, nu dintr-o
                  lista de nume: cine cauta "verdele din frunze" il recunoaste
                  dupa culoare mai repede decat dupa cuvant. */}
              <div className="edit-chip-row edit-band-row" role="group" aria-label={tr('edit.color.band')}>
                {BANDS.map(key => (
                  <button
                    key={key}
                    type="button"
                    className={band === key ? 'edit-band active' : 'edit-band'}
                    style={{ '--band': BAND_SWATCH[key] } as CSSProperties}
                    onClick={() => setBand(key)}
                    aria-pressed={band === key}
                    aria-label={tr(`edit.color.${key}`)}
                    title={tr(`edit.color.${key}`)}
                  >
                    {/* Punct plin cand gama chiar a fost atinsa — altfel nu se
                        poate sti care dintre cele opt au fost reglate. */}
                    {!isNeutralBand(adjustments.hsl?.[key]) && <i aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <p className="edit-crop-hint">{tr(`edit.color.${band}`)}</p>
              <div className="edit-sliders">
                {BAND_SLIDERS.map(({ key, labelKey }) => (
                  <EditSlider
                    key={key}
                    label={tr(labelKey)}
                    value={adjustments.hsl?.[band]?.[key] ?? 0}
                    min={-100} max={100}
                    neutral={0}
                    onChange={v => updateBand(band, key, v)}
                  />
                ))}
              </div>
            </div>
          )}

          {tool === 'curves' && (
            <div className="edit-tool-panel">
              <div className="edit-chip-row" role="group" aria-label={tr('edit.curves.channel')}>
                {CURVE_CHANNEL_UI.map(({ key, labelKey }) => (
                  <button
                    key={key}
                    type="button"
                    className={curveChannel === key ? 'chip active' : 'chip'}
                    onClick={() => setCurveChannel(key)}
                  >
                    {tr(labelKey)}
                  </button>
                ))}
              </div>
              <CurveEditor
                points={currentCurve}
                onChange={setCurve}
                histogram={histogram}
                strokeColor={CURVE_CHANNEL_UI.find(c => c.key === curveChannel)!.color}
                label={tr('edit.curves.canvasLabel')}
                hint={tr('edit.curves.hint')}
              />
              <div className="edit-chip-row" role="group" aria-label={tr('edit.curves.presets')}>
                {CURVE_PRESETS.map(({ key, curves: preset }) => (
                  <button key={key} type="button" className="chip" onClick={() => applyCurvePreset(preset)}>
                    {tr(`edit.curves.preset.${key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tool === 'selective' && (
            <div className="edit-tool-panel">
              {selectedPoint ? (
                <>
                  <div className="edit-tool-panel-head">
                    <span className="edit-tool-panel-title">
                      {tr('edit.selective.point', { index: controlPoints.indexOf(selectedPoint) + 1 })}
                    </span>
                    <button className="ghost small-btn" onClick={removeSelectedPoint}>
                      <TrashIcon className="inline-icon" /> {tr('edit.selective.remove')}
                    </button>
                  </div>
                  <div className="edit-sliders">
                    <EditSlider
                      label={tr('edit.selective.size')}
                      value={Math.round(selectedPoint.radius * 100)}
                      min={Math.round(MIN_CONTROL_RADIUS * 100)} max={Math.round(MAX_CONTROL_RADIUS * 100)}
                      onChange={v => updateSelectedPoint('radius', v / 100)}
                    />
                    {CONTROL_SLIDERS.map(({ key, labelKey }) => (
                      <EditSlider
                        key={key}
                        label={tr(labelKey)}
                        value={selectedPoint[key]}
                        min={-100} max={100}
                        onChange={v => updateSelectedPoint(key, v)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="edit-crop-hint">{tr('edit.selective.hint')}</p>
              )}
            </div>
          )}

          {tool === 'heal' && (
            <div className="edit-tool-panel">
              <div className="edit-tool-panel-head">
                <span className="edit-tool-panel-title">
                  {tr(plural(healStrokes.length, 'edit.heal.count.one', 'edit.heal.count.other'), { count: healStrokes.length })}
                </span>
                <button className="ghost small-btn" onClick={undoLastHeal} disabled={healStrokes.length === 0}>
                  <UndoIcon className="inline-icon" /> {tr('edit.heal.undo')}
                </button>
              </div>
              <div className="edit-sliders">
                <EditSlider
                  label={tr('edit.heal.size')}
                  value={Math.round(healRadius * 1000)}
                  min={Math.round(MIN_HEAL_RADIUS * 1000)} max={Math.round(MAX_HEAL_RADIUS * 1000)}
                  onChange={v => setHealRadius(v / 1000)}
                />
              </div>
              <p className="edit-crop-hint">{tr('edit.heal.hint')}</p>
            </div>
          )}
          {/* Actiunile late care nu incap in bara de sus stau intr-un rand propriu,
              imediat deasupra uneltelor: apar rar si nu au voie sa fure inaltime
              din poza cat timp nu exista. */}
          {(cropDraft || (momentSiblings.length > 0 && !isNeutral(adjustments))) && (
            <div className="edit-wide-actions">
              {cropDraft ? (
                <button className="ghost small-btn" onClick={clearCropDraft}>{tr('edit.crop.reset')}</button>
              ) : (
                /* Un fix aprobat pe un cadru e aproape sigur bun si pe restul
                   cadrelor din aceeasi lumina — vezi core/momentStacks.ts si
                   applyEditsToMoment din store. */
                <button className="ghost small-btn" onClick={() => void applyToMoment()}>
                  <LayersIcon className="inline-icon" /> {tr('edit.applyToMoment', { count: momentSiblings.length })}
                </button>
              )}
            </div>
          )}
          {/* Bara de instrumente. Pana acum, recadrarea se pornea dintr-un
              buton din antet, iar restul editarii era o singura lista de
              slidere — doua feluri diferite de a intra in doua feluri diferite
              de editare. Acum toate cinci sunt intrari egale in acelasi loc. */}
          <div className="edit-tools" role="tablist" aria-label={tr('edit.tools')}>
            {TOOLS.map(({ key, labelKey, icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tool === key}
                className={tool === key ? 'edit-tool active' : 'edit-tool'}
                onClick={() => selectTool(key)}
                disabled={!imgEl}
              >
                <span className="edit-tool-icon" aria-hidden="true">{icon}</span>
                <span className="edit-tool-label">{tr(labelKey)}</span>
              </button>
            ))}
          </div>

          </div>
        </div>
      </div>
    </div>
  );
}
