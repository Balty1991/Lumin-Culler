import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import { computeAutoAdjustments, isNeutral, type EditAdjustments } from '../core/imageAdjust';
import { getDisplayUrl } from '../core/previewUrlCache';
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
export function EnhanceSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const addCorrectedCopies = useStore(s => s.addCorrectedCopies);
  const [src, setSrc] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditAdjustments | null>(null);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(50);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [url, a] = await Promise.all([getDisplayUrl(photo.id), db.analyses.get(photo.id)]);
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
      setEdits(lightOnly);
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

  const nothing = edits && isNeutral(edits);
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
