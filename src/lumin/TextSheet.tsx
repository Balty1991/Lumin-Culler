import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Culorile la îndemână; „auto” o alege din poză (autoTextColor). */
export const TEXT_COLORS = ['auto', '#ffffff', '#1d1022', '#ff4f7b', '#ffd36b', '#fff1dc', '#6fe3a1', '#8fd3ff', '#a98bff'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

function lum(r: number, g: number, b: number): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * Culoarea „Auto”: nuanța cea mai vie din poză (geaca roz, cerul, iarba),
 * apoi deschisă sau închisă până se citește clar peste fundalul de sub text
 * (contrast cel puțin 4,5:1). O poză fără culoare vie primește alb sau
 * aproape-negru, după fundal.
 */
export function autoTextColor(img: CanvasImageSource, w: number, h: number, top: boolean): string {
  const n = 48;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';
  ctx.drawImage(img, 0, 0, w, h, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  // Nuanța: histogramă pe 12 felii de culoare, cântărită cu saturația.
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let bandL = 0, bandN = 0;
  const y0 = top ? 0 : Math.floor(n * 0.72), y1 = top ? Math.ceil(n * 0.28) : n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    if (y >= y0 && y < y1) { bandL += lum(r, g, b); bandN++; }
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    if (sat < 0.35 || max < 60) continue;
    let hue = 0;
    if (max === r) hue = ((g - b) / (max - min)) % 6; else if (max === g) hue = (b - r) / (max - min) + 2; else hue = (r - g) / (max - min) + 4;
    const bin = bins[Math.floor(((hue * 60 + 360) % 360) / 30)];
    const wt = sat * sat;
    bin.w += wt; bin.r += r * wt; bin.g += g * wt; bin.b += b * wt;
  }
  const band = bandN ? bandL / bandN : 0.3;
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  const darkBand = band < 0.4;
  if (best.w < n * n * 0.02) return darkBand ? '#ffffff' : '#1d1022';
  let r = best.r / best.w, g = best.g / best.w, b = best.b / best.w;
  // Spre alb pe fundal închis, spre închis pe fundal deschis, până se citește.
  const target = darkBand ? 255 : 20;
  for (let step = 0; step < 12 && contrast(lum(r, g, b), band) < 4.5; step++) {
    r += (target - r) * 0.18; g += (target - g) * 0.18; b += (target - b) * 0.18;
  }
  return hex(r, g, b);
}

async function loadPhoto(id: string): Promise<ImageBitmap | null> {
  const url = (canSharpen() ? await sharpUrl(id, 2048).catch(() => null) : null) ?? (await getDisplayUrl(id).catch(() => null));
  if (!url) return null;
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}

export function drawTextOnPhoto(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, text: string, look: Look, top: boolean, color = '#ffffff'): void {
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
  // Umbra e opusul textului: întunecată sub textul deschis, o aură deschisă sub cel închis.
  const m = /^#(..)(..)(..)$/.exec(color);
  const light = m ? lum(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) > 0.35 : true;
  ctx.shadowColor = light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = px * 0.35;
  ctx.fillStyle = color;
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
  const [color, setColor] = useState<TextColor>('auto');
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const autoColor = useMemo(() => (img ? autoTextColor(img, img.width, img.height, top) : '#ffffff'), [img, top]);
  const ink = color === 'auto' ? autoColor : color;

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
    if (ctx) drawTextOnPhoto(ctx, img, c.width, c.height, text, look, top, ink);
  }, [img, text, look, top, ink]);

  const render = async (): Promise<Blob | null> => {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawTextOnPhoto(ctx, img, c.width, c.height, text, look, top, ink);
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
        <div className="lx-text-colors" role="radiogroup" aria-label={tr('lx.text.color')}>
          {TEXT_COLORS.map(c => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={c === 'auto' ? tr('lx.text.colorAuto') : c}
              className={`lx-text-swatch${color === c ? ' on' : ''}${c === 'auto' ? ' auto' : ''}`}
              style={{ ['--sw' as string]: c === 'auto' ? autoColor : c }} onClick={() => setColor(c)}>
              {c === 'auto' && <span>Auto</span>}
            </button>
          ))}
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
