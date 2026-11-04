import { Capacitor } from '@capacitor/core';
import { eraseInBrowser } from '../core/webInpaint';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { getDisplayUrl } from '../core/previewUrlCache';
import { useStore, type PhotoView } from '../state/store';
import { cloudAvailable, cloudInpaint, ensureCloud, type InpaintMode } from './cloud';
import { eraseOnDevice, onDeviceEditAvailable, prepareLargeEraser } from '../core/onDeviceEdit';
import { samAvailable, samPrepare, samSelect } from '../core/samSelect';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { useTr } from './context';
import { aiSize, fillMasked, maskBounds, type Rect } from './magic';
import { canSharpen, sharpUrl } from './sharp';

/**
 * lumin/MagicSheet.tsx
 * „Magie”: guma AI (tragi cu degetul peste ce vrei să dispară) și cerul nou
 * (senin sau la apus), cu AI-ul online, cu acord. Pleacă doar bucata din jurul
 * zonei (sau poza micșorată, pentru cer); rezultatul se pune înapoi doar în
 * zonă, cu margini moi. Se salvează ca o poză nouă, în Cherrypic/Editate;
 * originalul rămâne neatins.
 */
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [painted, setPainted] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  /** „Atinge obiectul” (SlimSAM): pregătit o dată per poză, apoi fiecare atingere selectează. */
  const [sam, setSam] = useState<'off' | 'busy' | 'ready'>(samAvailable() ? 'busy' : 'off');
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => { prepareLargeEraser(); }, []);
  useEffect(() => {
    if (!img || !samAvailable()) return;
    let alive = true;
    setSam('busy');
    void samPrepare(img).then(ok => { if (alive) setSam(ok ? 'ready' : 'off'); });
    return () => { alive = false; };
  }, [img]);

  /** Atingere scurtă, fără tras: selectează tot obiectul de sub deget și îl adaugă la mască. */
  const tapSelect = async (e: PointerEvent<HTMLCanvasElement>) => {
    if (!img || !mask.current || result) return;
    const box = e.currentTarget.getBoundingClientRect();
    const sel = await samSelect((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    if (!sel || !mask.current) return;
    const [tint, tctx] = canvasOf(img.width, img.height);
    // Puțin mai largă decât obiectul: guma are nevoie de margine ca să nu lase contur.
    const r = Math.max(2, Math.round(Math.max(img.width, img.height) * 0.008));
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      tctx.drawImage(sel, dx, dy, img.width, img.height);
    }
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgb(255,60,90)';
    tctx.fillRect(0, 0, img.width, img.height);
    mask.current.getContext('2d')!.drawImage(tint, 0, 0);
    setPainted(true);
    redraw();
  };

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

  const finishLocal = (mode: InpaintMode) => {
    if (!img || !mask.current) return false;
    const [final, fctx] = canvasOf(img.width, img.height);
    fctx.drawImage(img, 0, 0);
    const pix = fctx.getImageData(0, 0, img.width, img.height);
    const sample = sampledMask(mask.current, 1);
    if (!sample.data.some(v => v)) return false;
    fillMasked(pix.data, sample.data, img.width, img.height, mode);
    // Marginea estompată: umplutura intră în poză doar prin masca înmuiată.
    const [patch, pctx] = canvasOf(img.width, img.height);
    pctx.putImageData(pix, 0, 0);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.filter = `blur(${Math.max(2, Math.round(Math.max(img.width, img.height) * 0.004))}px)`;
    pctx.drawImage(mask.current, 0, 0);
    pctx.filter = 'none';
    fctx.drawImage(patch, 0, 0);
    setResult(final);
    setNotice(tr('lx.magic.local'));
    return true;
  };

  const run = async (mode: InpaintMode) => {
    if (!img || !mask.current) return;
    setBusy(true);
    try {
      // Guma merge pe telefon (MI-GAN), gratuit și fără internet; serverul doar pentru cer.
      const native = mode === 'erase' && (await onDeviceEditAvailable()).erase;
      // În browser: același tip de model (MI-GAN), rulat în pagină, fără server.
      const web = mode === 'erase' && !native && !Capacitor.isNativePlatform();
      const online = !native && !web && cloudAvailable() && await ensureCloud(askConfirm, tr);
      if (!native && !web && !online) { finishLocal(mode); return; }
      // Bucata trimisă: pentru gumă, cutia din jurul zonei (cu context); pentru cer, toată poza.
      let r: Rect = { x: 0, y: 0, w: img.width, h: img.height };
      if (mode === 'erase') {
        const step = 8;
        const s = sampledMask(mask.current, step);
        const b = maskBounds(s.data, s.w, s.h);
        if (!b) return;
        r = { x: b.x * step, y: b.y * step, w: Math.min(img.width - b.x * step, b.w * step), h: Math.min(img.height - b.y * step, b.h * step) };
        // Modelul de pe telefon are nevoie de context în jurul zonei: cutie cam pătrată, de ~2,2× zona.
        if (native || web) {
          const side = Math.min(Math.max(img.width, img.height), Math.max(160, Math.max(r.w, r.h) * 2.2));
          const w = Math.min(img.width, side), h = Math.min(img.height, side);
          const x = Math.max(0, Math.min(img.width - w, r.x + r.w / 2 - w / 2));
          const y = Math.max(0, Math.min(img.height - h, r.y + r.h / 2 - h / 2));
          r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
        }
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
      let ai: ImageBitmap | HTMLCanvasElement;
      if (web) {
        const filled = await eraseInBrowser(ic, mc).catch(() => null);
        if (!filled) { finishLocal(mode); return; }
        ai = filled;
      } else {
      const [imageBlob, maskBlob] = await Promise.all([toBlob(ic, 'image/jpeg', 0.92), toBlob(mc, 'image/png')]);
      if (!imageBlob || !maskBlob) return;
      const out = native
        ? await eraseOnDevice(imageBlob, maskBlob).then(b => (b ? { ok: true as const, image: b } : { ok: false as const }))
        : await cloudInpaint(mode, imageBlob, maskBlob, size.width, size.height);
      if (!out.ok) { finishLocal(mode); return; }
      ai = await createImageBitmap(out.image);
      }
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
      const ok = await saveEditedBlob(blob, 'guma');
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
            onPointerDown={e => { drawing.current = true; down.current = { x: e.clientX, y: e.clientY, t: performance.now() }; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }}
            onPointerMove={paint}
            onPointerUp={e => {
              drawing.current = false;
              const d = down.current; down.current = null;
              if (sam === 'ready' && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && performance.now() - d.t < 350) void tapSelect(e);
            }}
            onPointerCancel={() => { drawing.current = false; down.current = null; }} />
        )}
        {busy && <div className="lx-magic-busy"><span className="lx-spinner" />{tr('lx.magic.working')}</div>}
      </div>
      <div className="lx-viewer-info">
        {!result ? (
          <>
            <p className="lx-hint center">{tr(sam === 'ready' ? 'lx.magic.tapHint' : 'lx.magic.eraseHint')}{sam === 'busy' && <> · {tr('lx.magic.tapPreparing')}</>}</p>
            <div className="lx-decide-actions">
              <button className="lx-btn ghost" disabled={!painted || busy} onClick={() => { clearMask(); redraw(); }}>{tr('lx.magic.clear')}</button>
              <button className="lx-btn primary" disabled={!painted || busy} onClick={() => void run('erase')}>{tr('lx.magic.eraseGo')}</button>
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
