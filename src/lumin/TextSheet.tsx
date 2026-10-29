import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDisplayUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { shareCollage } from './collage';
import { useTr } from './context';
import { saveEditedBlob } from './saveEdited';
import { canSharpen, sharpUrl } from './sharp';

/**
 * lumin/TextSheet.tsx
 * „Text pe poză”: „Prima zi de școală”, data sau locul, scris frumos peste
 * poză, sus sau jos, în trei stiluri. Se trimite sau se salvează ca poză nouă;
 * originalul rămâne neatins.
 */
type Look = 'classic' | 'bold' | 'hand';
const LOOKS: Look[] = ['classic', 'bold', 'hand'];
const FONTS: Record<Look, string> = {
  classic: '600 {px}px Georgia, "Times New Roman", serif',
  bold: '800 {px}px "Sora Variable", "Inter Variable", sans-serif',
  hand: 'italic 600 {px}px "Segoe Script", "Brush Script MT", cursive'
};

async function loadPhoto(id: string): Promise<ImageBitmap | null> {
  const url = (canSharpen() ? await sharpUrl(id, 2048).catch(() => null) : null) ?? (await getDisplayUrl(id).catch(() => null));
  if (!url) return null;
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}

export function drawTextOnPhoto(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, text: string, look: Look, top: boolean): void {
  ctx.drawImage(img, 0, 0, w, h);
  if (!text.trim()) return;
  const px = Math.round(Math.min(w, h) * (look === 'bold' ? 0.075 : 0.07));
  ctx.font = FONTS[look].replace('{px}', String(px));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n').slice(0, 3);
  const lineH = px * 1.2;
  const blockH = lines.length * lineH;
  const y0 = top ? h * 0.06 + lineH / 2 : h - h * 0.06 - blockH + lineH / 2;
  if (look === 'bold') {
    const band = ctx.createLinearGradient(0, top ? 0 : h - blockH - h * 0.12, 0, top ? blockH + h * 0.12 : h);
    band.addColorStop(top ? 0 : 1, 'rgba(0,0,0,0.55)');
    band.addColorStop(top ? 1 : 0, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, top ? 0 : h - blockH - h * 0.12, w, blockH + h * 0.12);
  }
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = px * 0.35;
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(look === 'bold' ? l.toUpperCase() : l, w / 2, y0 + i * lineH, w * 0.9));
  ctx.shadowColor = 'transparent';
}

export function TextSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const setNotice = useStore(s => s.setNotice);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const when = photo.capturedAt ? new Date(photo.capturedAt).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const [text, setText] = useState(when);
  const [look, setLook] = useState<Look>('classic');
  const [top, setTop] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    void loadPhoto(photo.id).then(b => { if (alive) setImg(b); });
    return () => { alive = false; };
  }, [photo.id]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d');
    if (ctx) drawTextOnPhoto(ctx, img, c.width, c.height, text, look, top);
  }, [img, text, look, top]);

  const render = async (): Promise<Blob | null> => {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawTextOnPhoto(ctx, img, c.width, c.height, text, look, top);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.94));
  };
  const share = async () => { setBusy(true); try { const b = await render(); if (b) await shareCollage(b, `cherrypic-text-${Date.now()}.jpg`, text); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true);
    try {
      const b = await render();
      const ok = b ? await saveEditedBlob(b, 'text') : false;
      setNotice(tr(ok ? 'lx.magic.saved' : 'lx.magic.failed'));
      if (ok) onClose();
    } catch { setNotice(tr('lx.magic.failed')); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-enhance" role="dialog" aria-modal="true" aria-label={tr('lx.text.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">Aa {tr('lx.text.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        {img ? <canvas ref={canvas} className="lx-magic-canvas" /> : <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.enhance.working')}</div>}
      </div>
      <div className="lx-viewer-info">
        <textarea className="lx-text-input" rows={2} maxLength={80} value={text} onChange={e => setText(e.target.value)} placeholder={tr('lx.text.placeholder')} />
        <div className="lx-enhance-styles">
          {LOOKS.map(l => <button key={l} className={look === l ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setLook(l)}>{tr(`lx.text.look.${l}`)}</button>)}
          <button className={top ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setTop(v => !v)}>{tr(top ? 'lx.text.top' : 'lx.text.bottom')}</button>
        </div>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" disabled={!img || busy} onClick={() => void share()}>↗ {tr('lx.wall.share')}</button>
          <button className="lx-btn primary" disabled={!img || busy} onClick={() => void save()}>{tr('lx.magic.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
