import { useEffect, useRef, useState } from 'react';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { drawAdjusted, isNeutral, NEUTRAL_ADJUSTMENTS, type EditAdjustments } from '../core/imageAdjust';
import { XIcon, UndoIcon } from './icons';
import { t } from '../i18n';

const SLIDERS: (keyof EditAdjustments)[] = [
  'exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'
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
  const photos = useStore(s => s.photos);
  const setEditAdjustments = useStore(s => s.setEditAdjustments);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  const photo = photos.find(p => p.id === editingId) ?? null;
  useModalFocusTrap(containerRef, !!photo);

  const [adjustments, setAdjustments] = useState<EditAdjustments>(NEUTRAL_ADJUSTMENTS);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!photo) return;
    setAdjustments(photo.edits ?? NEUTRAL_ADJUSTMENTS);
    setImgEl(null);
    let alive = true;
    void getCachedPreviewUrl(photo.id).then(url => {
      if (!alive || !url) return;
      const img = new Image();
      img.onload = () => { if (alive) setImgEl(img); };
      img.src = url;
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id]);

  // Redesenare pe requestAnimationFrame — dragul unui slider poate emite multe
  // evenimente pe cadru; fara asta, un pixel-pass complet (temperatura/tinta/
  // highlights/shadows) ar rula de mai multe ori inutil pentru acelasi cadru vizual.
  useEffect(() => {
    if (!imgEl || !canvasRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) drawAdjusted(ctx, imgEl, canvas.width, canvas.height, adjustments);
    });
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [imgEl, adjustments]);

  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, setEditingId]);

  if (!photo) return null;

  const update = (key: keyof EditAdjustments, value: number) => {
    const next = { ...adjustments, [key]: value };
    setAdjustments(next);
    void setEditAdjustments(photo.id, next);
  };

  const resetAll = () => {
    setAdjustments(NEUTRAL_ADJUSTMENTS);
    void setEditAdjustments(photo.id, NEUTRAL_ADJUSTMENTS);
  };

  return (
    <div className="edit-scrim" onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}>
      <div className="edit-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('edit.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('edit.title')}</span>
          <div className="contact-sheet-header-actions">
            <button className="ghost small-btn" onClick={resetAll} disabled={isNeutral(adjustments)}>
              <UndoIcon className="inline-icon" /> {tr('edit.reset')}
            </button>
            <button className="ghost icon-btn" onClick={() => setEditingId(null)} aria-label={tr('detail.close')}>
              <XIcon />
            </button>
          </div>
        </header>

        <div className="edit-body">
          <div className="edit-canvas-wrap">
            <canvas ref={canvasRef} className="edit-canvas" />
            {!imgEl && <span className="card-loading edit-canvas-loading" aria-hidden="true" />}
          </div>
          <div className="edit-sliders">
            {SLIDERS.map(key => (
              <label key={key} className="edit-slider-row">
                <span className="edit-slider-label">{tr(`edit.${key}`)}</span>
                <input
                  type="range" min={-100} max={100} step={1}
                  value={adjustments[key]}
                  onChange={e => update(key, Number(e.target.value))}
                />
                <span className="edit-slider-value mono">{adjustments[key]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
