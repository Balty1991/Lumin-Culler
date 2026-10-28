import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { computeAutoAdjustments, NEUTRAL_ADJUSTMENTS, type EditAdjustments } from '../core/imageAdjust';
import { getCachedPreviewUrl, getDisplayUrl } from '../core/previewUrlCache';
import { canSharpen, sharpUrl } from './sharp';
import { useStore, type PhotoView } from '../state/store';
import { AdjustedImage } from '../ui/AdjustedImage';
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
export type EnhanceStyle = 'natural' | 'vivid' | 'warm' | 'drama';
export const ENHANCE_STYLES: EnhanceStyle[] = ['natural', 'vivid', 'warm', 'drama'];
const STYLE_ADD: Record<EnhanceStyle, Partial<Record<keyof EditAdjustments, number>>> = {
  natural: { contrast: 8, saturation: 10, clarity: 18, sharpen: 20, dehaze: 6, shadows: 10 },
  vivid: { contrast: 16, saturation: 26, clarity: 28, sharpen: 24, dehaze: 14, shadows: 18, highlights: -12 },
  warm: { contrast: 10, saturation: 16, temperature: 20, tint: 4, clarity: 16, sharpen: 18, shadows: 14 },
  drama: { contrast: 30, saturation: -6, clarity: 42, sharpen: 26, dehaze: 22, vignette: 28, highlights: -30, shadows: 22 }
};

const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));

/** Corecția automată + stilul, la intensitatea aleasă (0..1,5). */
export function styledEdits(base: EditAdjustments, style: EnhanceStyle, amount: number): EditAdjustments {
  const out: EditAdjustments = { ...base };
  const keys = new Set([...Object.keys(NEUTRAL_ADJUSTMENTS), ...Object.keys(STYLE_ADD[style])]) as Set<keyof EditAdjustments>;
  for (const k of keys) {
    const b = base[k];
    if (k === 'rotationDeg' || (b !== undefined && typeof b !== 'number')) continue;
    const v = ((b as number | undefined) ?? 0) + (STYLE_ADD[style][k] ?? 0);
    (out as unknown as Record<string, number>)[k] = clamp(v * amount);
  }
  return out;
}

export function EnhanceSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const [src, setSrc] = useState<string | null>(null);
  const [base, setBase] = useState<EditAdjustments | null>(null);
  const [style, setStyle] = useState<EnhanceStyle>('vivid');
  const [amount, setAmount] = useState(1.2);
  const deferredAmount = useDeferredValue(amount);
  const edits = useMemo(() => (base ? styledEdits(base, style, deferredAmount) : null), [base, style, deferredAmount]);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(50);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Pe telefon: poza clară făcută de Android (originalul direct ieșea negru pe unele telefoane).
      const source = canSharpen()
        ? sharpUrl(photo.id, 1600).then(u => u ?? getCachedPreviewUrl(photo.id))
        : getDisplayUrl(photo.id);
      const [url, a] = await Promise.all([source, db.analyses.get(photo.id)]);
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
      const lightOnly: EditAdjustments = { ...auto, crop: undefined, rotationDeg: 0 };
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
              <AdjustedImage src={src} edits={edits} alt="" />
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
              {ENHANCE_STYLES.map(st => (
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
