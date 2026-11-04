import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';
import { loadEditable } from './sharp';
import { saveEditedBlob } from './saveEdited';
import { shareCollage } from './collage';
import { filmFromKeyframes, type BurstFilm } from './burstFilm';
import { FilmSheet } from './FilmSheet';
import { intlTag } from '../i18n';

/**
 * lumin/Rephoto.tsx
 * „Fereastra în trecut”: camera se deschide cu poza veche transparentă peste
 * ce vezi acum, ca s-o refaci din același loc și unghi. Apoi: atunci și acum,
 * una lângă alta (sau trecerea dintre ele, ca film). Totul pe telefon.
 */
export function canRephoto(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function cover(src: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const k = Math.max(w / sw, h / sh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
  return c;
}

export function RephotoSheet({ photoId, takenAt, onClose }: { photoId: string; takenAt?: number; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const video = useRef<HTMLVideoElement>(null);
  const [old, setOld] = useState<HTMLImageElement | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [error, setError] = useState(false);
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  const [split, setSplit] = useState(50);
  const [film, setFilm] = useState<BurstFilm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadEditable(photoId, 1600).then(r => { if (alive && r) setOld(r.img); });
    return () => { alive = false; };
  }, [photoId]);

  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      }, () => setError(true));
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, [shot]);

  // Poza nouă = exact ce se vede pe ecran (aceeași încadrare ca poza veche de deasupra).
  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth || !old) return;
    const box = v.getBoundingClientRect();
    const k = Math.min(2, 1600 / Math.max(box.width, box.height)) * (window.devicePixelRatio > 1 ? 1 : 1);
    const w = Math.round(box.width * k / 2) * 2, h = Math.round(box.height * k / 2) * 2;
    setShot(cover(v, v.videoWidth, v.videoHeight, w, h));
    try { navigator.vibrate?.(15); } catch { /* fără */ }
  };

  const thenLabel = takenAt ? new Date(takenAt).toLocaleDateString(intlTag(locale), { month: 'long', year: 'numeric' }) : tr('lx.pair.then');
  const pair = async (): Promise<Blob | null> => {
    if (!shot || !old) return null;
    const w = shot.width, h = shot.height;
    const a = cover(old, old.naturalWidth, old.naturalHeight, w, h);
    const c = document.createElement('canvas');
    const vertical = w > h;
    c.width = vertical ? w : w * 2 + 12; c.height = vertical ? h * 2 + 12 : h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#050305'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0);
    ctx.drawImage(shot, vertical ? 0 : w + 12, vertical ? h + 12 : 0);
    const label = (t: string, x: number, y: number) => {
      ctx.font = `700 ${Math.round(Math.min(w, h) * 0.05)}px system-ui, sans-serif`;
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(5,3,5,0.6)'; ctx.fillRect(x, y, tw + 32, Math.min(w, h) * 0.08);
      ctx.fillStyle = '#fff6f9'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + 16, y + Math.min(w, h) * 0.04);
    };
    label(thenLabel, 20, 20);
    label(tr('lx.pair.now'), (vertical ? 0 : w + 12) + 20, (vertical ? h + 12 : 0) + 20);
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
  };

  const saveNew = async () => {
    if (!shot) return;
    const b = await new Promise<Blob | null>(res => shot.toBlob(x => res(x), 'image/jpeg', 0.94));
    const ok = b ? await saveEditedBlob(b, 'refacuta') : false;
    useStore.getState().setNotice(tr(ok ? 'lx.rephoto.saved' : 'lx.magic.failed'));
  };
  const sharePair = async () => { const b = await pair(); if (b) await shareCollage(b, `cherrypic-atunci-acum-${Date.now()}.jpg`, tr('lx.rephoto.shareText')); };
  const makeFilm = async () => {
    if (!shot || !old) return;
    setBusy(true);
    try {
      const a = cover(old, old.naturalWidth, old.naturalHeight, shot.width, shot.height);
      const f = await filmFromKeyframes([a, shot], { transition: 'fade', speed: 'slow', loop: 'bounce', music: 'calm' });
      if (f) setFilm(f);
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-enhance lx-rephoto" role="dialog" aria-modal="true" aria-label={tr('lx.rephoto.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.rephoto.title')}</span>
        <span />
      </header>
      {error ? <p className="lx-empty">{tr('lx.rephoto.noCamera')}</p> : !shot ? (
        <>
          <div className="lx-rephoto-view">
            <video ref={video} playsInline muted autoPlay />
            {old && <img src={old.src} alt="" style={{ opacity }} />}
            <span className="lx-rephoto-tag">{thenLabel}</span>
          </div>
          <div className="lx-viewer-info lx-rephoto-ctrl">
            <label className="lx-rephoto-slider"><span>{tr('lx.rephoto.ghost')}</span>
              <input type="range" min={0} max={0.9} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} />
            </label>
            <p className="lx-hint center">{tr('lx.rephoto.hint')}</p>
            <button className="lx-rephoto-shutter" onClick={capture} disabled={!old} aria-label={tr('lx.rephoto.capture')}><span /></button>
          </div>
        </>
      ) : (
        <>
          <div className="lx-rephoto-view result" onPointerMove={e => { if (e.buttons) { const r = e.currentTarget.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))); } }}
            onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))); }}>
            <img src={shot.toDataURL('image/jpeg', 0.9)} alt="" />
            {old && <img src={old.src} alt="" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />}
            <span className="lx-rephoto-line" style={{ left: `${split}%` }} />
            <span className="lx-rephoto-tag">{thenLabel}</span>
            <span className="lx-rephoto-tag right">{tr('lx.pair.now')}</span>
          </div>
          <div className="lx-viewer-info">
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" onClick={() => setShot(null)}>{tr('lx.rephoto.retake')}</button>
              <button className="lx-btn ghost" onClick={() => void saveNew()}>{tr('lx.rephoto.saveNew')}</button>
            </div>
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" disabled={busy} onClick={() => void makeFilm()}><Icon name="film" size={16} /> {tr('lx.rephoto.film')}</button>
              <button className="lx-btn primary" onClick={() => void sharePair()}>↗ {tr('lx.rephoto.share')}</button>
            </div>
          </div>
        </>
      )}
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </div>,
    document.body
  );
}
