import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { computeAutoAdjustments, computeAutoStraighten, drawAdjusted, NEUTRAL_ADJUSTMENTS, outputSize, subjectFromFaces, type EditAdjustments } from '../core/imageAdjust';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, sharpUrl } from './sharp';
import { isNativeSegmentationAvailable, segmentPersonMask } from '../core/nativeSegmentation';
import { useStore, type PhotoView } from '../state/store';
import { frameCrop } from './instaCrop';
import { cloudAvailable, cloudGrade, ensureCloud } from './cloud';
import { saveEditedBlob } from './saveEdited';
import { useTr } from './context';

/**
 * lumin/Enhance.tsx
 * „Fă-o mai frumoasă”: o atingere, AI-ul reglează lumina, umbrele, albul și
 * culoarea după ce vede în poză (aceleași calcule ca butonul Auto din editor,
 * core/imageAdjust.ts), iar tu tragi de linie ca să vezi înainte și după.
 *
 * Doar lumină și culoare: fără decupaj sau rotire, ca înainte/după să se
 * suprapună exact și ca nimic din cadru să nu dispară pe nepusă masă.
 * Se salvează ca o copie; fișierul din galerie nu se atinge.
 */
/**
 * Stilurile: peste corecția automată (lumină, alb, culoare măsurate din poză),
 * fiecare adaugă un aspect vizibil. Raportat: „varianta editată nu are prea
 * multe îmbunătățiri” — corecția singură e doar „de siguranță”.
 */
export type EnhanceStyle = 'natural' | 'portrait' | 'retouch' | 'vivid' | 'warm' | 'clear' | 'film' | 'bw' | 'drama';
export const ENHANCE_STYLES: EnhanceStyle[] = ['natural', 'portrait', 'retouch', 'vivid', 'warm', 'clear', 'film', 'bw', 'drama'];
/** Stilurile din Pro: le poți încerca, salvarea cere abonamentul. */
const ADVANCED: ReadonlySet<EnhanceStyle> = new Set(['portrait', 'retouch', 'clear', 'film', 'bw', 'drama']);
/** Stilurile care au nevoie de un om în poză (fundalul estompat în jurul lui). */
const NEEDS_FACE: ReadonlySet<EnhanceStyle> = new Set(['portrait', 'retouch']);
const STYLE_ADD: Record<EnhanceStyle, Partial<Record<keyof EditAdjustments, number>>> = {
  // Cu alb și negru duși spre capete: pe pozele cu cer înnorat, fără ele „după” arăta ca „înainte”
  // (raportat cu capturi, Natural și Clară aproape identice cu originalul).
  // Măsurat pe poza raportată: mai multă lumină, zonele luminoase nu mai coborâte (cerul
  // înnorat ieșea gri), negrul doar puțin — cum a reglat omul de mână și i-a plăcut.
  natural: { exposure: 10, contrast: 14, saturation: 6, clarity: 14, sharpen: 16, shadows: 18, highlights: 4, whites: 10, blacks: -3 },
  vivid: { contrast: 18, saturation: 14, clarity: 22, sharpen: 20, dehaze: 12, shadows: 14, highlights: -14, whites: 10, blacks: -9 },
  warm: { contrast: 12, saturation: 8, temperature: 16, tint: 3, clarity: 14, sharpen: 16, shadows: 12, whites: 6, blacks: -6 },
  drama: { contrast: 26, saturation: -10, clarity: 34, sharpen: 22, dehaze: 16, vignette: 24, highlights: -28, shadows: 20 },
  // Portret: fundalul estompat în jurul fețelor, pielea moale (claritate scăzută), lumină caldă.
  // Retuș: ten mai neted (netezirea zgomotului, fără claritate), lumină caldă și blândă pe față.
  retouch: { noiseReduction: 45, clarity: -16, sharpen: 4, contrast: 2, exposure: 3, shadows: 14, highlights: -10, temperature: 5, saturation: 2, vignette: 8 },
  portrait: { bokeh: 60, contrast: 6, saturation: 2, temperature: 6, clarity: -8, sharpen: 8, shadows: 12, highlights: -10, vignette: 16 },
  // Clar: umbrele deschise și luminile coborâte, detaliu scos în evidență (un HDR blând).
  // Cu alb și negru ținute la capete: fără ele cerul ieșea gri și poza spălată
  // (raportat cu captură, la 125%).
  clear: { contrast: 16, saturation: 8, clarity: 36, sharpen: 26, dehaze: 16, shadows: 22, highlights: -24, whites: 12, blacks: -11 },
  // Film: culori de cinema (umbre reci, lumini calde), granulație fină.
  film: { contrast: 4, saturation: -6, grade: 45, grain: 16, clarity: 8, sharpen: 10, shadows: 10, highlights: -14, vignette: 12 },
  bw: { bw: 100, contrast: 18, saturation: 0, clarity: 22, sharpen: 18, grain: 10, vignette: 14, shadows: 8, highlights: -12 }
};
/**
 * Plafonul culorii, oricât de sus e intensitatea: peste el pielea se înroșește
 * și cerul devine fosforescent (raportat: „parcă saturează cam mult”).
 */
const MAX_SATURATION = 20;

const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));

/** Corecția automată + stilul, la intensitatea aleasă (0..1,5). */
export function styledEdits(base: EditAdjustments, style: EnhanceStyle, amount: number): EditAdjustments {
  const out: EditAdjustments = { ...base };
  if (!NEEDS_FACE.has(style)) delete out.bokehSubject;
  const keys = new Set([...Object.keys(NEUTRAL_ADJUSTMENTS), ...Object.keys(STYLE_ADD[style])]) as Set<keyof EditAdjustments>;
  for (const k of keys) {
    const b = base[k];
    if (k === 'rotationDeg' || (b !== undefined && typeof b !== 'number')) continue;
    const v = ((b as number | undefined) ?? 0) + (STYLE_ADD[style][k] ?? 0);
    (out as unknown as Record<string, number>)[k] = clamp(v * amount);
  }
  out.saturation = Math.min(MAX_SATURATION, out.saturation);
  if (style === 'bw') out.bw = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, amount * 1.5))));
  if (NEEDS_FACE.has(style) && !out.bokehSubject) out.bokeh = 0;
  if (style === 'retouch') delete out.bokehSubject;
  return out;
}

/**
 * Corecția automată a unei poze (lumină, alb, culoare — fără decupaj sau rotire),
 * plus URL-ul imaginii din care a fost măsurată.
 */
export async function autoEnhance(photoId: string): Promise<{ url: string; edits: EditAdjustments; tilt: number; width: number; height: number; faces: { box: [number, number, number, number] }[] }> {
  // Pe telefon: poza clară făcută de Android (originalul direct ieșea negru pe unele telefoane).
  const source = canSharpen()
    ? sharpUrl(photoId, 1600).then(u => u ?? getCachedPreviewUrl(photoId))
    : getDisplayUrl(photoId);
  const [url, a] = await Promise.all([source, db.analyses.get(photoId)]);
  if (!url) throw new Error('fără imagine');
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('imaginea nu s-a încărcat'));
    el.src = url;
  });
  const auto = computeAutoAdjustments(img, img.naturalWidth, img.naturalHeight, {
    exposureScore: a?.exposure,
    highlightClipping: a?.highlightClipping,
    shadowClipping: a?.shadowClipping,
    faceCount: a?.faceCount,
    faces: a?.faces,
    colorHarmonyScore: a?.colorHarmonyScore,
    goldenHourDetected: a?.goldenHourDetected
  });
  // Puțină lumină în plus, cât trebuie pentru poza asta (raportat: Natural arăta mult mai
  // bine cu Luminozitate +20 pusă de mână). Măsurată pe fețe, unde sunt, altfel pe toată
  // poza; o poză deja luminoasă nu primește nimic.
  auto.exposure = Math.max(-100, Math.min(100, auto.exposure + brightnessLift(img, a?.faces)));
  // Fără răcire: pe cer înnorat corecția de alb mergea spre albastru (−16) și poza ieșea
  // vânătă; o încălzire ușoară rămâne, o răcire de peste −4 nu.
  auto.temperature = Math.max(-4, auto.temperature);
  // Unde e omul (din fețele găsite la import): stilul Portret estompează în jurul lui.
  // Cu tot corpul: fără decupajul modelului, zona clară pornește de la față și coboară
  // cât un om întreg (umeri mai lați decât fața), nu doar un umăr sub ea.
  const face = subjectFromFaces(a?.faces);
  const subject = face ? (() => {
    const faceH = face.height / 2;
    const x = Math.max(0, face.x - face.width * 0.6);
    const right = Math.min(1, face.x + face.width * 1.6);
    return { x, y: face.y, width: right - x, height: Math.min(1, face.y + faceH * 7.5) - face.y };
  })() : null;
  // Orizontul strâmb (măsurat la import, doar pe pozele fără oameni): îndreptarea e o opțiune, nu implicită.
  const tilt = computeAutoStraighten({ faceCount: a?.faceCount, horizonTiltDeg: a?.horizonTiltDeg });
  return {
    url, tilt, width: img.naturalWidth, height: img.naturalHeight,
    faces: (a?.faces ?? []).map(f => ({ box: f.box as [number, number, number, number] })),
    edits: { ...auto, crop: undefined, rotationDeg: 0, ...(subject ? { bokehSubject: subject } : {}) }
  };
}

/** Cât să se deschidă lumina (0..24): fețele spre ~62% luminozitate, poza întreagă spre ~52%. */
export function liftFor(luma: number, onFaces: boolean): number {
  const target = onFaces ? 0.62 : 0.52;
  return Math.round(Math.max(0, Math.min(24, (target - luma) * (onFaces ? 110 : 90))));
}

function brightnessLift(img: HTMLImageElement, faces?: readonly { box: [number, number, number, number] }[]): number {
  try {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = n; c.height = n;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    const big = (faces ?? []).filter(f => f.box[2] * f.box[3] >= 0.004);
    let sum = 0, count = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      if (big.length && !big.some(({ box: [bx, by, bw, bh] }) => u >= bx && u <= bx + bw && v >= by && v <= by + bh)) continue;
      const i = (y * n + x) * 4;
      sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      count++;
    }
    if (!count) return 0;
    return liftFor(sum / count, big.length > 0 && count >= 4);
  } catch { return 0; }
}

/** „Fă-le pe toate mai frumoase”: stilul Natural pe fiecare, salvate ca și copii. */
export async function enhanceAll(photoIds: readonly string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const plans: { sourceId: string; adjustments: EditAdjustments }[] = [];
  for (let i = 0; i < photoIds.length; i++) {
    try {
      const { edits } = await autoEnhance(photoIds[i]);
      plans.push({ sourceId: photoIds[i], adjustments: styledEdits(edits, 'natural', 1) });
    } catch { /* o poză care nu se citește nu oprește restul */ }
    onProgress?.(i + 1, photoIds.length);
  }
  return plans.length ? useStore.getState().addCorrectedCopies(plans) : 0;
}

/**
 * Reglajele manuale: cerute („mai poți upgrada editorul… și la lumina și tonul
 * de culoare”). Se adaugă peste stil, deci „Natural” + „Lumină +20” e poza
 * aleasă de AI, doar mai luminoasă.
 */
type Panel = 'styles' | 'light' | 'color' | 'frame';
type ManualPanel = 'light' | 'color';
const PANELS: Panel[] = ['styles', 'light', 'color', 'frame'];
/** Proporțiile din „Cadru” (lățime / înălțime); cadrul se așază pe fețe (frameCrop). */
type Aspect = 'orig' | '4:5' | '1:1' | '9:16' | '16:9' | '3:2';
const ASPECTS: Record<Aspect, number> = { orig: 0, '4:5': 4 / 5, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, '3:2': 3 / 2 };
type ManualKey = 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'clarity' | 'vignette' | 'temperature' | 'tint' | 'saturation' | 'dehaze' | 'sharpen' | 'noiseReduction' | 'grain';
const MANUAL: Record<ManualPanel, { key: ManualKey; min?: number; track?: string }[]> = {
  light: [
    { key: 'exposure' }, { key: 'contrast' }, { key: 'highlights' }, { key: 'shadows' },
    { key: 'whites' }, { key: 'blacks' }, { key: 'clarity' }, { key: 'dehaze' }, { key: 'vignette' }
  ],
  color: [
    { key: 'temperature', track: 'temp' }, { key: 'tint', track: 'tint' }, { key: 'saturation', track: 'sat' },
    { key: 'sharpen', min: 0 }, { key: 'noiseReduction', min: 0 }, { key: 'grain', min: 0 }
  ]
};
/**
 * Gustul omului în editor: media (lentă) a reglajelor pe care le salvează. Dacă
 * pune mereu +10 la lumină, editorul pornește data viitoare cu +10 — vizibil în
 * Lumină și Culoare, și se poate da înapoi. Doar valorile clare (|v| ≥ 3).
 */
const TASTE_KEY = 'lumin-editor-taste';
function readEditorTaste(): Partial<Record<ManualKey, number>> {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? '{}') as { n?: number; v?: Record<string, number> };
    if (!raw.n || raw.n < 2 || !raw.v) return {};
    const out: Partial<Record<ManualKey, number>> = {};
    for (const [k, v] of Object.entries(raw.v)) if (Math.abs(v) >= 3) out[k as ManualKey] = Math.round(v);
    return out;
  } catch { return {}; }
}
function learnEditorTaste(manual: Partial<Record<ManualKey, number>>): void {
  try {
    const raw = JSON.parse(localStorage.getItem(TASTE_KEY) ?? '{}') as { n?: number; v?: Record<string, number> };
    const n = raw.n ?? 0;
    const v = { ...(raw.v ?? {}) };
    const keys = new Set([...Object.keys(v), ...Object.keys(manual)]);
    const a = n === 0 ? 1 : 0.3; // media mobilă: ultimele poze contează mai mult
    for (const k of keys) v[k] = (1 - a) * (v[k] ?? 0) + a * (manual[k as ManualKey] ?? 0);
    localStorage.setItem(TASTE_KEY, JSON.stringify({ n: n + 1, v }));
  } catch { /* fără stocare */ }
}

/** Stilul + reglajele omului, în limitele fiecărui reglaj. */
export function withManual(e: EditAdjustments, manual: Partial<Record<ManualKey, number>>): EditAdjustments {
  const out = { ...e } as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(manual)) {
    if (!v) continue;
    const lo = k === 'sharpen' || k === 'grain' || k === 'noiseReduction' ? 0 : -100;
    out[k] = Math.max(lo, Math.min(100, Math.round((out[k] ?? 0) + v)));
  }
  return out as unknown as EditAdjustments;
}

export function EnhanceSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const premiumLocked = useStore(s => s.premiumLocked);
  const [src, setSrc] = useState<string | null>(null);
  const [base, setBase] = useState<EditAdjustments | null>(null);
  const [style, setStyle] = useState<EnhanceStyle>('natural');
  const [amount, setAmount] = useState(1);
  const [tilt, setTilt] = useState(0);
  const [straight, setStraight] = useState(false);
  // „Lumină” și „Culoare”: reglajele omului, adăugate peste stil (0 = cum a ales AI-ul).
  const [panel, setPanel] = useState<Panel>('styles');
  // Pornește cu reglajele pe care omul le pune de obicei (învățate la „Păstrez”).
  const [manual, setManual] = useState<Partial<Record<ManualKey, number>>>(() => readEditorTaste());
  const learned = useMemo(() => Object.keys(readEditorTaste()).length > 0, []);
  // „Cadru”: proporția (cadrul așezat pe fețe) și înclinarea aleasă de om.
  const [aspect, setAspect] = useState<Aspect>('orig');
  const [userTilt, setUserTilt] = useState<number | null>(null);
  const [geo, setGeo] = useState<{ width: number; height: number; faces: { box: [number, number, number, number] }[] } | null>(null);
  const crop = useMemo(() => {
    if (aspect === 'orig' || !geo) return undefined;
    const r = frameCrop(geo.width, geo.height, ASPECTS[aspect], geo.faces);
    return { x: r.x / geo.width, y: r.y / geo.height, width: r.w / geo.width, height: r.h / geo.height };
  }, [aspect, geo]);
  const rotation = userTilt ?? (straight ? tilt : 0);
  // Portret: omul decupat de modelul de segmentare de pe telefon, nu doar o zonă rotundă
  // în jurul feței (raportat: picioarele și cizmele ieșeau estompate).
  const [personMask, setPersonMask] = useState<{ image: CanvasImageSource; focusY: number | null } | null>(null);
  useEffect(() => {
    if (style !== 'portrait' || personMask || !src || !isNativeSegmentationAvailable()) return;
    let alive = true;
    void (async () => {
      const blob = await (await fetch(src)).blob();
      const m = await segmentPersonMask(blob, base?.bokehSubject ?? undefined);
      if (alive && m.personCoverage >= 0.03) setPersonMask({ image: m.image, focusY: m.focusY });
    })().catch(() => {});
    return () => { alive = false; };
  }, [style, src, personMask, base]);
  const edits = useMemo(() => {
    if (!base) return null;
    const e = withManual({ ...styledEdits(base, style, amount), rotationDeg: rotation, ...(crop ? { crop } : {}) }, manual);
    return style === 'portrait' && personMask ? { ...e, bokehMask: personMask.image, ...(personMask.focusY !== null ? { bokehFocusY: personMask.focusY } : {}) } : e;
  }, [base, style, amount, rotation, crop, manual, personMask]);
  const styles = ENHANCE_STYLES.filter(st => !NEEDS_FACE.has(st) || !!base?.bokehSubject);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(50);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { url, edits: lightOnly, tilt: t, width, height, faces } = await autoEnhance(photo.id);
      if (!alive) return;
      setGeo({ width, height, faces });
      setTilt(t);
      setSrc(url);
      setBase(lightOnly);
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [photo.id]);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !dragging.current) return;
    setSplit(Math.max(0, Math.min(100, ((e.clientX - box.left) / box.width) * 100)));
  };
  // „Auto AI”: varianta de acum, micșorată, merge la AI-ul online; reglajele lui se adună
  // peste stil, în Lumină și Culoare, unde omul le vede și le poate muta mai departe.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReason, setAiReason] = useState('');
  const aiAuto = async () => {
    if (!src || !edits) return;
    if (!(await ensureCloud(useStore.getState().askConfirm, tr))) return;
    setAiBusy(true);
    try {
      const img = await createImageBitmap(await (await fetch(src)).blob());
      const k = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      drawAdjusted(ctx, img, img.width, img.height, c.width, c.height, { ...edits, crop: undefined, bokehMask: undefined, bokeh: 0 });
      const r = await cloudGrade(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      if (!r) { useStore.getState().setNotice(tr('lx.magic.failed')); return; }
      setManual(v => {
        const n = { ...v };
        for (const [key, val] of Object.entries(r.values)) {
          if (!MANUAL.light.some(m => m.key === key) && !MANUAL.color.some(m => m.key === key)) continue;
          n[key as ManualKey] = Math.max(-100, Math.min(100, (n[key as ManualKey] ?? 0) + val));
        }
        return n;
      });
      setAiReason(r.reason);
    } finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!edits) return;
    learnEditorTaste(manual);
    if (ADVANCED.has(style) && useStore.getState().gatePremium('styles')) return;
    setSaving(true);
    try {
      // Portretul cu omul decupat: masca nu se păstrează în copie (se reface din poză),
      // deci rezultatul se salvează gata făcut, ca poză nouă, la rezoluție mare.
      if (style === 'portrait' && edits.bokehMask) {
        const url = (canSharpen() ? await sharpUrl(photo.id, 3000).catch(() => null) : null) ?? src;
        const img = url ? await createImageBitmap(await (await fetch(url)).blob()) : null;
        if (img) {
          const o = outputSize(img.width, img.height, edits);
          const c = document.createElement('canvas');
          c.width = o.width; c.height = o.height;
          const ctx = c.getContext('2d');
          if (ctx) {
            drawAdjusted(ctx, img, img.width, img.height, o.width, o.height, edits);
            const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.94));
            const ok = blob ? await saveEditedBlob(blob, 'portret') : false;
            useStore.getState().setNotice(tr(ok ? 'lx.magic.saved' : 'lx.magic.failed'));
            if (ok) { onClose(); return; }
          }
        }
      }
      await addCorrectedCopies([{ sourceId: photo.id, adjustments: edits }]);
      // Aceeași lumină pentru toată ziua: celelalte poze păstrate din aceeași zi au de
      // obicei aceeași lumină, deci primesc aceleași reglaje (fără decupaj și fără estompare).
      const day = photo.capturedAt ? new Date(photo.capturedAt).toDateString() : null;
      const siblings = day ? useStore.getState().photos.filter(p => p.id !== photo.id && p.status === 'selected' && !p.aside && p.mediaUri && p.capturedAt && new Date(p.capturedAt).toDateString() === day) : [];
      if (siblings.length && await useStore.getState().askConfirm(tr('lx.enhance.applyDay', { count: siblings.length }), { confirmLabel: tr('lx.enhance.applyDayGo') })) {
        const shared = { ...edits, crop: undefined, bokeh: 0, bokehMask: undefined, bokehSubject: undefined, rotationDeg: 0 };
        await addCorrectedCopies(siblings.map(p => ({ sourceId: p.id, adjustments: shared })));
      }
      onClose();
    } finally { setSaving(false); }
  };

  const nothing = false;
  return createPortal(
    <div className="lx lx-enhance" role="dialog" aria-modal="true" aria-label={tr('lx.enhance.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.enhance.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage" ref={stage}
        onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
        onPointerMove={move} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
        {!src && !failed && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.enhance.working')}</div>}
        {failed && <p className="lx-empty">{tr('lx.enhance.failed')}</p>}
        {src && edits && (edits.crop || panel === 'frame') ? (
          <div className="lx-enhance-frame cropped">
            <LivePreview src={src} edits={edits} />
          </div>
        ) : src && edits && (
          <div className="lx-enhance-frame">
            <img src={src} alt="" draggable={false} />
            <div className="lx-enhance-after" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              <LivePreview src={src} edits={edits} />
            </div>
            {!nothing && (
              <>
                <span className="lx-enhance-line" style={{ left: `${split}%` }}><i /></span>
                <span className="lx-enhance-tag left">{tr('lx.enhance.before')}</span>
                <span className="lx-enhance-tag right">{tr('lx.enhance.after')}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="lx-viewer-info">
        {base && (
          <>
            <div className="lx-enhance-tabs" role="tablist">
              {PANELS.map(pn => (
                <button key={pn} role="tab" aria-selected={panel === pn} className={panel === pn ? 'on' : ''} onClick={() => setPanel(pn)}>
                  {tr(`lx.enhance.panel.${pn}`)}
                  {(pn === 'frame' ? aspect !== 'orig' || rotation !== 0 : pn !== 'styles' && MANUAL[pn].some(m => manual[m.key])) && <i aria-hidden="true" />}
                </button>
              ))}
            </div>
            {learned && Object.keys(manual).length > 0 && <p className="lx-hint">{tr('lx.enhance.learned')}</p>}
            {panel !== 'frame' && cloudAvailable() && (
              <div className="lx-ai-auto">
                <button className="lx-btn ghost small" disabled={aiBusy} onClick={() => void aiAuto()}>{aiBusy ? `… ${tr('lx.enhance.aiWorking')}` : `✨ ${tr('lx.enhance.aiAuto')}`}</button>
                {aiReason && <span>{aiReason}</span>}
              </div>
            )}
            {panel === 'frame' ? (
              <div className="lx-enhance-sliders">
                <div className="lx-enhance-styles" role="radiogroup" aria-label={tr('lx.enhance.panel.frame')}>
                  {(Object.keys(ASPECTS) as Aspect[]).map(a => (
                    <button key={a} role="radio" aria-checked={aspect === a} className={aspect === a ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setAspect(a)}>
                      {a === 'orig' ? tr('lx.enhance.aspect.orig') : a}
                    </button>
                  ))}
                </div>
                <label className="lx-enhance-amount">
                  <span>{tr('lx.enhance.tilt')}</span>
                  <input type="range" min={-8} max={8} step={0.5} value={rotation} onChange={e => setUserTilt(Number(e.target.value))} onDoubleClick={() => setUserTilt(0)} />
                  <b>{rotation > 0 ? '+' : ''}{rotation}°</b>
                </label>
                <p className="lx-hint">{tr('lx.enhance.frameHint')}</p>
              </div>
            ) : panel !== 'styles' ? (
              <div className="lx-enhance-sliders">
                {MANUAL[panel as ManualPanel].map(m => (
                  <label key={m.key} className="lx-enhance-amount">
                    <span>{tr(`lx.enhance.adj.${m.key}`)}</span>
                    <input type="range" min={m.min ?? -100} max={100} step={1} value={manual[m.key] ?? 0}
                      className={m.track ? `track-${m.track}` : undefined}
                      onChange={e => setManual(v => ({ ...v, [m.key]: Number(e.target.value) }))}
                      onDoubleClick={() => setManual(v => ({ ...v, [m.key]: 0 }))} />
                    <b>{(manual[m.key] ?? 0) > 0 ? '+' : ''}{manual[m.key] ?? 0}</b>
                  </label>
                ))}
                {MANUAL[panel as ManualPanel].some(m => manual[m.key]) && (
                  <button className="lx-link center" onClick={() => setManual(v => { const n = { ...v }; for (const m of MANUAL[panel as ManualPanel]) delete n[m.key]; return n; })}>{tr('lx.enhance.reset')}</button>
                )}
              </div>
            ) : (<>
            <div className="lx-enhance-styles" role="radiogroup" aria-label={tr('lx.enhance.style')}>
              {styles.map(st => (
                <button key={st} role="radio" aria-checked={style === st} className={style === st ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setStyle(st)}>
                  {tr(`lx.enhance.style.${st}`)}{ADVANCED.has(st) && premiumLocked && <b className="lx-pro">PRO</b>}
                </button>
              ))}
              {tilt !== 0 && (
                <button role="switch" aria-checked={straight} className={straight ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setStraight(v => !v)}>
                  📐 {tr('lx.enhance.straighten')}
                </button>
              )}
            </div>
            <label className="lx-enhance-amount">
              <span>{tr('lx.enhance.amount')}</span>
              <input type="range" min={0} max={150} step={5} value={Math.round(amount * 100)} onChange={e => setAmount(Number(e.target.value) / 100)} />
              <b>{Math.round(amount * 100)}%</b>
            </label>
            </>)}
          </>
        )}
        <p className="lx-hint center">{tr(nothing ? 'lx.enhance.nothing' : 'lx.enhance.hint')}</p>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr(nothing ? 'lx.close' : 'lx.enhance.cancel')}</button>
          {!nothing && <button className="lx-btn primary" disabled={!edits || saving} onClick={() => void save()}>{tr('lx.enhance.save')}</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * „După”, desenat direct pe ecran. Raportat: „când schimbi intensitatea, durează
 * câteva secunde bune”. Înainte fiecare pas al liniei refăcea poza de 1600 px
 * și o comprima în JPEG. Acum: întâi o variantă mică (640 px, câteva zeci de
 * ms), cât tragi de linie; când te oprești, aceeași poză la claritate deplină.
 */
const QUICK = 640;
function LivePreview({ src, edits }: { src: string; edits: EditAdjustments }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const small = useMemo(() => {
    if (!img) return null;
    const k = Math.min(1, QUICK / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }, [img]);

  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.onload = () => { if (alive) setImg(el); };
    el.src = src;
    return () => { alive = false; };
  }, [src]);

  useEffect(() => {
    const out = canvas.current;
    if (!out || !img || !small) return;
    const draw = (source: CanvasImageSource, w: number, h: number) => {
      // Cu decupaj, pânza ia proporția cadrului (altfel decupajul s-ar întinde).
      const o = outputSize(w, h, edits);
      if (out.width !== o.width || out.height !== o.height) { out.width = o.width; out.height = o.height; }
      const ctx = out.getContext('2d');
      if (ctx) try { drawAdjusted(ctx, source, w, h, o.width, o.height, edits); } catch { /* fără memorie: rămâne ultima */ }
    };
    const frame = requestAnimationFrame(() => draw(small, small.width, small.height));
    const full = window.setTimeout(() => draw(img, img.naturalWidth, img.naturalHeight), 380);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(full); };
  }, [img, small, edits]);

  return <canvas ref={canvas} className="lx-enhance-canvas" />;
}
