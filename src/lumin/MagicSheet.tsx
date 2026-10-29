import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { getDisplayUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { cloudInpaint, ensureCloud, type InpaintMode } from './cloud';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { useTr } from './context';
import { aiSize, maskBounds, maskCoverage, skyMask, type Rect } from './magic';
import { canSharpen, sharpUrl } from './sharp';

/**
 * lumin/MagicSheet.tsx
 * „Magie”: guma AI (tragi cu degetul peste ce vrei să dispară) și cerul nou
 * (senin sau la apus), cu AI-ul online, cu acord. Pleacă doar bucata din jurul
 * zonei (sau poza micșorată, pentru cer); rezultatul se pune înapoi doar în
 * zonă, cu margini moi. Se salvează ca o poză nouă, în Cherrypic/Editate;
 * originalul rămâne neatins.
 */
type Tool = 'erase' | 'sky';
const WORK = 2048;

async function loadSource(id: string): Promise<ImageBitmap | null> {
  const url = (canSharpen() ? await sharpUrl(id, WORK).catch(() => null) : null) ?? (await getDisplayUrl(id).catch(() => null));
  if (!url) return null;
  try { return await createImageBitmap(await (await fetch(url)).blob()); } catch { return null; }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>(r => c.toBlob(r, type, q));

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

/** Masca la rezoluția pozei, ca tablou 0/1 micșorat (pentru cutie), din canvasul pictat. */
function sampledMask(mask: HTMLCanvasElement, step: number): { data: Uint8Array; w: number; h: number } {
  const w = Math.ceil(mask.width / step), h = Math.ceil(mask.height / step);
  const [c, ctx] = canvasOf(w, h);
  ctx.drawImage(mask, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  void c;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4 + 3] > 20 ? 1 : 0;
  return { data, w, h };
}

export function MagicSheet({ photo, onClose }: { photo: PhotoView; onClose: () => void }) {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const setNotice = useStore(s => s.setNotice);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const [tool, setTool] = useState<Tool>('erase');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [painted, setPainted] = useState(false);
  const [noSky, setNoSky] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadSource(photo.id).then(b => { if (!alive) return; if (b) setImg(b); else setFailed(true); });
    return () => { alive = false; };
  }, [photo.id]);

  // Ecranul: poza (sau rezultatul) și, peste ea, masca în roșu transparent.
  const redraw = () => {
    const c = view.current;
    if (!c || !img) return;
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(result ?? img, 0, 0);
    if (!result && mask.current) {
      ctx.globalAlpha = 0.45;
      ctx.drawImage(mask.current, 0, 0);
      ctx.globalAlpha = 1;
    }
  };
  useEffect(() => {
    if (!img) return;
    if (!mask.current || mask.current.width !== img.width) mask.current = canvasOf(img.width, img.height)[0];
    redraw();
  });

  const clearMask = () => {
    const m = mask.current;
    m?.getContext('2d')?.clearRect(0, 0, m.width, m.height);
    setPainted(false);
    setNoSky(false);
  };

  // Cerul: găsit singur, pe o copie mică, apoi întins la mărimea pozei.
  const findSky = () => {
    if (!img || !mask.current) return;
    clearMask();
    const k = 256 / Math.max(img.width, img.height);
    const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
    const [, sctx] = canvasOf(w, h);
    sctx.drawImage(img, 0, 0, w, h);
    const m = skyMask(sctx.getImageData(0, 0, w, h).data, w, h);
    if (maskCoverage(m) < 0.05) { setNoSky(true); redraw(); return; }
    const [small, mctx] = canvasOf(w, h);
    const id = mctx.createImageData(w, h);
    for (let i = 0; i < m.length; i++) if (m[i]) id.data.set([255, 60, 90, 255], i * 4);
    mctx.putImageData(id, 0, 0);
    const ctx = mask.current.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, img.width, img.height);
    setPainted(true);
    redraw();
  };

  const paint = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !mask.current || !img || result) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * img.width;
    const y = ((e.clientY - box.top) / box.height) * img.height;
    const ctx = mask.current.getContext('2d')!;
    ctx.fillStyle = 'rgb(255,60,90)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(img.width, img.height) * 0.028, 0, Math.PI * 2);
    ctx.fill();
    setPainted(true);
    redraw();
  };

  const run = async (mode: InpaintMode) => {
    if (!img || !mask.current) return;
    if (!(await ensureCloud(askConfirm, tr))) return;
    setBusy(true);
    try {
      // Bucata trimisă: pentru gumă, cutia din jurul zonei (cu context); pentru cer, toată poza.
      let r: Rect = { x: 0, y: 0, w: img.width, h: img.height };
      if (mode === 'erase') {
        const step = 8;
        const s = sampledMask(mask.current, step);
        const b = maskBounds(s.data, s.w, s.h);
        if (!b) return;
        r = { x: b.x * step, y: b.y * step, w: Math.min(img.width - b.x * step, b.w * step), h: Math.min(img.height - b.y * step, b.h * step) };
      }
      const size = aiSize(r.w, r.h);
      const [ic, ictx] = canvasOf(size.width, size.height);
      ictx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, size.width, size.height);
      const [mc, mctx] = canvasOf(size.width, size.height);
      mctx.fillStyle = '#000';
      mctx.fillRect(0, 0, size.width, size.height);
      // Masca puțin mai lată decât zona pictată: marginea obiectului dispare și ea.
      mctx.filter = 'blur(2px)';
      mctx.drawImage(mask.current, r.x, r.y, r.w, r.h, 0, 0, size.width, size.height);
      mctx.filter = 'none';
      const md = mctx.getImageData(0, 0, size.width, size.height);
      for (let i = 0; i < md.data.length; i += 4) {
        const on = md.data[i] > 40 || md.data[i + 1] > 40 ? 255 : 0;
        md.data[i] = md.data[i + 1] = md.data[i + 2] = on;
        md.data[i + 3] = 255;
      }
      mctx.putImageData(md, 0, 0);
      const [imageBlob, maskBlob] = await Promise.all([toBlob(ic, 'image/jpeg', 0.92), toBlob(mc, 'image/png')]);
      if (!imageBlob || !maskBlob) return;
      const out = await cloudInpaint(mode, imageBlob, maskBlob, size.width, size.height);
      if (!out.ok) {
        if (out.reason !== 'limit') setNotice(tr(out.reason === 'consent' ? 'lx.magic.consent' : out.reason === 'budget' ? 'lx.cloud.budget' : 'lx.magic.failed'));
        return;
      }
      const ai = await createImageBitmap(out.image);
      // Înapoi în poză: rezultatul, doar unde e masca, cu marginea estompată.
      const [final, fctx] = canvasOf(img.width, img.height);
      fctx.drawImage(img, 0, 0);
      const [patch, pctx] = canvasOf(r.w, r.h);
      pctx.drawImage(ai, 0, 0, r.w, r.h);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.filter = `blur(${Math.max(2, Math.round(Math.max(r.w, r.h) * 0.01))}px)`;
      pctx.drawImage(mask.current, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      pctx.filter = 'none';
      fctx.drawImage(patch, r.x, r.y);
      setResult(final);
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const blob = await toBlob(result, 'image/jpeg', 0.94);
      if (!blob) return;
      const ok = await saveEditedBlob(blob, tool === 'sky' ? 'cer' : 'guma');
      setNotice(tr(ok ? 'lx.magic.saved' : 'lx.magic.failed'));
      if (ok) onClose();
    } catch {
      setNotice(tr('lx.magic.failed'));
    } finally { setBusy(false); }
  };

  const share = async () => {
    if (!result) return;
    const blob = await toBlob(result, 'image/jpeg', 0.94);
    if (blob) await shareCollage(blob, `cherrypic-${Date.now()}.jpg`, '');
  };

  return createPortal(
    <div className="lx lx-enhance lx-magic" role="dialog" aria-modal="true" aria-label={tr('lx.magic.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">🪄 {tr('lx.magic.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        {!img && !failed && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.enhance.working')}</div>}
        {failed && <p className="lx-empty">{tr('lx.enhance.failed')}</p>}
        {img && (
          <canvas ref={view} className="lx-magic-canvas"
            onPointerDown={e => { if (tool !== 'erase') return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }}
            onPointerMove={paint} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} />
        )}
        {busy && <div className="lx-magic-busy"><span className="lx-spinner" />{tr('lx.magic.working')}</div>}
      </div>
      <div className="lx-viewer-info">
        {!result ? (
          <>
            <div className="lx-enhance-tabs" role="tablist">
              <button role="tab" aria-selected={tool === 'erase'} className={tool === 'erase' ? 'on' : ''} onClick={() => { setTool('erase'); clearMask(); }}>{tr('lx.magic.erase')}</button>
              <button role="tab" aria-selected={tool === 'sky'} className={tool === 'sky' ? 'on' : ''} onClick={() => { setTool('sky'); setTimeout(findSky, 0); }}>{tr('lx.magic.sky')}</button>
            </div>
            <p className="lx-hint center">{tr(tool === 'erase' ? 'lx.magic.eraseHint' : noSky ? 'lx.magic.noSky' : 'lx.magic.skyHint')}</p>
            <div className="lx-decide-actions">
              {tool === 'erase' ? (
                <>
                  <button className="lx-btn ghost" disabled={!painted || busy} onClick={() => { clearMask(); redraw(); }}>{tr('lx.magic.clear')}</button>
                  <button className="lx-btn primary" disabled={!painted || busy} onClick={() => void run('erase')}>{tr('lx.magic.eraseGo')}</button>
                </>
              ) : (
                <>
                  <button className="lx-btn primary" disabled={!painted || busy} onClick={() => void run('sky-blue')}>☀ {tr('lx.magic.skyBlue')}</button>
                  <button className="lx-btn primary" disabled={!painted || busy} onClick={() => void run('sky-sunset')}>🌅 {tr('lx.magic.skySunset')}</button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="lx-hint center">{tr('lx.magic.resultHint')}</p>
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" disabled={busy} onClick={() => setResult(null)}>{tr('lx.magic.again')}</button>
              <button className="lx-btn ghost" disabled={busy} onClick={() => void share()}>↗ {tr('lx.wall.share')}</button>
              <button className="lx-btn primary" disabled={busy} onClick={() => void save()}>{tr('lx.magic.save')}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
