import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { computeAutoAdjustments, drawAdjusted, NEUTRAL_ADJUSTMENTS, subjectFromFaces, type EditAdjustments } from '../core/imageAdjust';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, sharpUrl } from './sharp';
import { useStore, type PhotoView } from '../state/store';
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
export type EnhanceStyle = 'natural' | 'portrait' | 'vivid' | 'warm' | 'clear' | 'film' | 'bw' | 'drama';
export const ENHANCE_STYLES: EnhanceStyle[] = ['natural', 'portrait', 'vivid', 'warm', 'clear', 'film', 'bw', 'drama'];
/** Stilurile care au nevoie de un om în poză (fundalul estompat în jurul lui). */
const NEEDS_FACE: ReadonlySet<EnhanceStyle> = new Set(['portrait']);
const STYLE_ADD: Record<EnhanceStyle, Partial<Record<keyof EditAdjustments, number>>> = {
  natural: { contrast: 8, saturation: 3, clarity: 14, sharpen: 18, dehaze: 4, shadows: 10, highlights: -8 },
  vivid: { contrast: 14, saturation: 10, clarity: 20, sharpen: 20, dehaze: 8, shadows: 14, highlights: -12 },
  warm: { contrast: 8, saturation: 6, temperature: 14, tint: 3, clarity: 12, sharpen: 16, shadows: 12 },
  drama: { contrast: 26, saturation: -10, clarity: 34, sharpen: 22, dehaze: 16, vignette: 24, highlights: -28, shadows: 20 },
  // Portret: fundalul estompat în jurul fețelor, pielea moale (claritate scăzută), lumină caldă.
  portrait: { bokeh: 60, contrast: 6, saturation: 2, temperature: 6, clarity: -8, sharpen: 8, shadows: 12, highlights: -10, vignette: 16 },
  // Clar: umbrele deschise și luminile coborâte, detaliu scos în evidență (un HDR blând).
  clear: { contrast: 4, saturation: 4, clarity: 28, sharpen: 22, dehaze: 12, shadows: 30, highlights: -30 },
  // Film: culori de cinema (umbre reci, lumini calde), granulație fină.
  film: { contrast: 4, saturation: -6, grade: 45, grain: 16, clarity: 8, sharpen: 10, shadows: 10, highlights: -14, vignette: 12 },
  bw: { bw: 100, contrast: 18, saturation: 0, clarity: 22, sharpen: 18, grain: 10, vignette: 14, shadows: 8, highlights: -12 }
};
/**
 * Plafonul culorii, oricât de sus e intensitatea: peste el pielea se înroșește
 * și cerul devine fosforescent (raportat: „parcă saturează cam mult”).
 */
const MAX_SATURATION = 16;

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
  return out;
}

/**
 * Corecția automată a unei poze (lumină, alb, culoare — fără decupaj sau rotire),
 * plus URL-ul imaginii din care a fost măsurată.
 */
export async function autoEnhance(photoId: string): Promise<{ url: string; edits: EditAdjustments }> {
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
  // Unde e omul (din fețele găsite la import): stilul Portret estompează în jurul lui.
  const subject = subjectFromFaces(a?.faces);
  return { url, edits: { ...auto, crop: undefined, rotationDeg: 0, ...(subject ? { bokehSubject: subject } : {}) } };
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

export function EnhanceSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const [src, setSrc] = useState<string | null>(null);
  const [base, setBase] = useState<EditAdjustments | null>(null);
  const [style, setStyle] = useState<EnhanceStyle>('natural');
  const [amount, setAmount] = useState(1);
  const edits = useMemo(() => (base ? styledEdits(base, style, amount) : null), [base, style, amount]);
  const styles = ENHANCE_STYLES.filter(st => !NEEDS_FACE.has(st) || !!base?.bokehSubject);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(50);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { url, edits: lightOnly } = await autoEnhance(photo.id);
      if (!alive) return;
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
  const save = async () => {
    if (!edits) return;
    setSaving(true);
    try {
      await addCorrectedCopies([{ sourceId: photo.id, adjustments: edits }]);
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
        {src && edits && (
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
            <div className="lx-enhance-styles" role="radiogroup" aria-label={tr('lx.enhance.style')}>
              {styles.map(st => (
                <button key={st} role="radio" aria-checked={style === st} className={style === st ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setStyle(st)}>
                  {tr(`lx.enhance.style.${st}`)}
                </button>
              ))}
            </div>
            <label className="lx-enhance-amount">
              <span>{tr('lx.enhance.amount')}</span>
              <input type="range" min={0} max={150} step={5} value={Math.round(amount * 100)} onChange={e => setAmount(Number(e.target.value) / 100)} />
              <b>{Math.round(amount * 100)}%</b>
            </label>
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
      if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
      const ctx = out.getContext('2d');
      if (ctx) try { drawAdjusted(ctx, source, w, h, w, h, edits); } catch { /* fără memorie: rămâne ultima */ }
    };
    const frame = requestAnimationFrame(() => draw(small, small.width, small.height));
    const full = window.setTimeout(() => draw(img, img.naturalWidth, img.naturalHeight), 380);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(full); };
  }, [img, small, edits]);

  return <canvas ref={canvas} className="lx-enhance-canvas" />;
}
