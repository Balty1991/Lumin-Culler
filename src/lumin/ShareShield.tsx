import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../core/db';
import type { PhotoView } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';
import { loadEditable } from './sharp';
import { shareCollage } from './collage';

/**
 * lumin/ShareShield.tsx
 * „Scutul de partajare”: înainte să trimiți o poză, fețele străinilor (sau
 * oricare alegi tu) se estompează, iar locația și celelalte date ascunse din
 * fișier dispar (poza e refăcută de la zero, fără EXIF). Totul pe telefon.
 */
type Face = { box: [number, number, number, number]; known: boolean };

/** Merită arătat scutul? Când poza are locație sau fețe necunoscute lângă oameni cunoscuți. */
export async function shieldWorthy(p: PhotoView): Promise<boolean> {
  if (p.gpsLatitude !== undefined) return true;
  const a = await db.analyses.get(p.id);
  const faces = a?.faces ?? [];
  return faces.some(f => f.personName) && faces.some(f => !f.personName);
}

export async function protectedBlob(img: HTMLImageElement, faces: Face[], blur: boolean[]): Promise<Blob | null> {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  faces.forEach((f, i) => {
    if (!blur[i]) return;
    const [bx, by, bw, bh] = f.box;
    const cx = (bx + bw / 2) * W, cy = (by + bh / 2) * H;
    const rx = bw * W * 0.75, ry = bh * H * 0.85;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
    // Puternic: o față estompată nu se mai poate recunoaște.
    ctx.filter = `blur(${Math.max(12, Math.round(Math.max(rx, ry) * 0.35))}px)`;
    ctx.drawImage(img, 0, 0);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(40,30,35,0.15)'; ctx.fill();
    ctx.restore();
  });
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.93));
}

export function ShareShield({ photo, onClose, onOriginal }: { photo: PhotoView; onClose: () => void; onOriginal: () => void }) {
  const tr = useTr();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [blur, setBlur] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [r, a] = await Promise.all([loadEditable(photo.id, 2048), db.analyses.get(photo.id)]);
      if (!alive || !r?.img) return;
      const fs = (a?.faces ?? []).map(f => ({ box: f.box, known: !!f.personName }));
      setImg(r.img); setFaces(fs);
      // Propunerea: necunoscuții se estompează; dacă nu e niciun cunoscut, niciunul (alegi tu).
      const anyKnown = fs.some(f => f.known);
      setBlur(fs.map(f => anyKnown && !f.known));
    })();
    return () => { alive = false; };
  }, [photo.id]);
  const send = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const b = await protectedBlob(img, faces, blur);
      if (b) await shareCollage(b, `cherrypic-${Date.now()}.jpg`, '');
      onClose();
    } finally { setBusy(false); }
  };
  const count = blur.filter(Boolean).length;
  return createPortal(
    <div className="lx lx-enhance lx-shield" role="dialog" aria-modal="true" aria-label={tr('lx.shield.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.shield.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        {!img ? <div className="lx-enhance-wait"><span className="lx-spinner" /></div> : (
          <div className="lx-shield-frame">
            <img src={img.src} alt="" />
            {faces.map((f, i) => (
              <button key={i} className={blur[i] ? 'lx-shield-face on' : 'lx-shield-face'} aria-pressed={blur[i]}
                style={{ left: `${f.box[0] * 100}%`, top: `${f.box[1] * 100}%`, width: `${f.box[2] * 100}%`, height: `${f.box[3] * 100}%` }}
                onClick={() => setBlur(b => b.map((v, j) => (j === i ? !v : v)))} aria-label={tr('lx.shield.toggle')} />
            ))}
          </div>
        )}
      </div>
      <div className="lx-viewer-info lx-shield-info">
        <p><Icon name="check" size={14} /> {tr('lx.shield.noLocation')}</p>
        <p>{faces.length ? tr('lx.shield.faces', { count }) : tr('lx.shield.noFaces')}</p>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={() => { onClose(); onOriginal(); }}>{tr('lx.shield.original')}</button>
          <button className="lx-btn primary" disabled={!img || busy} onClick={() => void send()}><Icon name="lock" size={16} /> {tr('lx.shield.send')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Pe butonul „Trimite”: scutul doar când e ceva de protejat, altfel trimite direct. */
export function useShieldedShare(photo: PhotoView, shareOriginal: () => void) {
  const [open, setOpen] = useState(false);
  const share = () => { void shieldWorthy(photo).then(w => (w ? setOpen(true) : shareOriginal())); };
  const sheet = open ? <ShareShield photo={photo} onClose={() => setOpen(false)} onOriginal={shareOriginal} /> : null;
  return { share, open: () => setOpen(true), sheet };
}

