import { useEffect, useRef, useState } from 'react';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { computeAutoAdjustments, drawAdjusted, isNeutral, NEUTRAL_ADJUSTMENTS, type EditAdjustments } from '../core/imageAdjust';
import { db, type AnalysisRecord } from '../core/db';
import { XIcon, UndoIcon, SparkleIcon } from './icons';
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
  // scorurile AI deja calculate pentru poza (acelasi AnalysisRecord afisat in
  // tab-ul "De ce acest scor") — sursa pentru butonul Auto, vezi applyAuto mai jos
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);

  useEffect(() => {
    if (!photo) return;
    setAdjustments(photo.edits ?? NEUTRAL_ADJUSTMENTS);
    setImgEl(null);
    setAnalysis(null);
    let alive = true;
    void getCachedPreviewUrl(photo.id).then(url => {
      if (!alive || !url) return;
      const img = new Image();
      img.onload = () => { if (alive) setImgEl(img); };
      img.src = url;
    });
    void db.analyses.get(photo.id).then(a => { if (alive) setAnalysis(a ?? null); });
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

  /**
   * "Editor AI automat" (cerinta directa a utilizatorului): expunerea si
   * recuperarea highlights/shadows se bazeaza pe scorurile AI DEJA calculate
   * pentru poza (`analysis`, acelasi AnalysisRecord din tab-ul "De ce acest
   * scor") — nu o re-analiza independenta, ca sa nu ajunga vreodata sa
   * contrazica explicatia pe care utilizatorul o vede deja pentru acelasi
   * cadru (vezi core/imageAdjust.ts, computeAutoAdjustments). Ruleaza pe imgEl
   * (imaginea deja incarcata, needitata), nu pe canvas-ul cu ajustari deja
   * aplicate. Ramane complet reversibil — apasarea Auto doar precompleteaza
   * sliderele, exact ca si cum utilizatorul le-ar fi tras singur.
   */
  const applyAuto = () => {
    if (!imgEl) return;
    const auto = computeAutoAdjustments(imgEl, imgEl.naturalWidth, imgEl.naturalHeight, {
      exposureScore: analysis?.exposure,
      highlightClipping: analysis?.highlightClipping,
      shadowClipping: analysis?.shadowClipping
    });
    setAdjustments(auto);
    void setEditAdjustments(photo.id, auto);
  };

  return (
    <div className="edit-scrim" onClick={e => { if (e.target === e.currentTarget) setEditingId(null); }}>
      <div className="edit-modal" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('edit.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('edit.title')}</span>
          <div className="contact-sheet-header-actions">
            <button className="ghost small-btn edit-auto-btn" onClick={applyAuto} disabled={!imgEl}>
              <SparkleIcon className="inline-icon" /> {tr('edit.auto')}
            </button>
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
            {/* Bug real gasit de auditul QA: singurul loc din aplicatie unde poza e
                afisata fara nicio alternativa text pentru un cititor de ecran —
                DetailView/Workspace/etc au toate alt={photo.fileName}, doar canvas-ul
                de aici nu avea nimic. Canvas nu are `alt`, dar poate primi role="img"
                + aria-label, exact echivalentul semantic. */}
            <canvas ref={canvasRef} className="edit-canvas" role="img" aria-label={photo.fileName} />
            {!imgEl && <span className="card-loading edit-canvas-loading" aria-hidden="true" />}
          </div>
          <div className="edit-sliders">
            {SLIDERS.map(key => (
              <label key={key} className="edit-slider-row">
                <span className="edit-slider-label" aria-hidden="true">{tr(`edit.${key}`)}</span>
                <input
                  type="range" min={-100} max={100} step={1}
                  value={adjustments[key]}
                  onChange={e => update(key, Number(e.target.value))}
                  // Bug real gasit de auditul QA: label-ul invaluia si numele SI
                  // valoarea numerica, deci numele accesibil calculat includea
                  // ambele (ex. "Expunere 20"), iar cititorul de ecran anunta
                  // valoarea A DOUA OARA separat (nativ, la fiecare schimbare de
                  // range) — redundant. aria-label explicit foloseste DOAR numele.
                  aria-label={tr(`edit.${key}`)}
                />
                <span className="edit-slider-value mono" aria-hidden="true">{adjustments[key]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
