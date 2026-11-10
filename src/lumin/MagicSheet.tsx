import { Capacitor } from '@capacitor/core';
import { eraseInBrowser } from '../core/webInpaint';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { cloudAvailable, cloudInpaint, ensureCloud, type InpaintMode } from './cloud';
import { eraseOnDevice, onDeviceEditAvailable, prepareLargeEraser } from '../core/onDeviceEdit';
import { samAvailable, samPrepare, samSelect } from '../core/samSelect';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { useTr } from './context';
import { aiSize, fillMasked, maskBounds, maskComponents, type Rect } from './magic';
import { fetchEngine } from './engines';
import { loadEditableBitmap } from './sharp';
import { t } from '../i18n';
import { useHoldAnalysis } from './useHoldAnalysis';

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
  const r = await loadEditableBitmap(id, WORK);
  if (r?.low) useStore.getState().setNotice(t(useStore.getState().locale, 'lx.edit.lowRes'));
  return r?.bitmap ?? null;
}

/** Claritate (mască de contrast 3×3) și granulație fină, cu tăria `k` (0..1). */
function restoreTexture(ctx: CanvasRenderingContext2D, w: number, h: number, k: number) {
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data, src = new Uint8ClampedArray(d);
  const amt = 0.5 + 0.7 * k, grain = 2 + 4 * k;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    const n = (Math.random() + Math.random() - 1) * grain;
    for (let c = 0; c < 3; c++) {
      const j = i + c;
      const avg = (src[j - 4] + src[j + 4] + src[j - w * 4] + src[j + w * 4]) / 4;
      d[j] = src[j] + (src[j] - avg) * amt + n;
    }
  }
  ctx.putImageData(im, 0, 0);
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
  useHoldAnalysis();
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
  const [sam, setSam] = useState<'off' | 'busy' | 'ready' | 'fail'>(samAvailable() ? 'busy' : 'off');
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const started = useRef(false);
  const strokes = useRef<Array<{ kind: 'brush'; r: number; pts: Array<[number, number]> } | { kind: 'sam'; sel: CanvasImageSource }>>([]);
  const newStroke = useRef(true);
  /** Grosimea pensulei, din latura pozei (mică / medie / mare). */
  const [brush, setBrush] = useState(0.028);
  /** Zoom cu două degete: `s` mărirea, `x/y` mutarea (px pe ecran). */
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; ox: number; oy: number; s: number; ux: number; uy: number } | null>(null);
  const pinched = useRef(false);
  useEffect(() => { void fetchEngine('eraser').catch(() => false); prepareLargeEraser(); }, []);
  useEffect(() => {
    if (!img || !samAvailable()) return;
    let alive = true;
    setSam('busy');
    // Modelul de selecție vine prin aceeași descărcare ca restul motoarelor (cu reluare);
    // dacă nu merge, plugin-ul mai încearcă singur, iar la final se vede starea.
    void (async () => {
      await fetchEngine('select').catch(() => false);
      const ok = await samPrepare(img);
      if (alive) setSam(ok ? 'ready' : 'fail');
    })();
    return () => { alive = false; };
  }, [img]);

  /** Atingere scurtă, fără tras: selectează tot obiectul de sub deget și îl adaugă la mască. */
  const tapSelect = async (e: PointerEvent<HTMLCanvasElement>) => {
    if (!img || !mask.current || result) return;
    const box = e.currentTarget.getBoundingClientRect();
    const sel = await samSelect((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    if (!sel || !mask.current) return;
    strokes.current.push({ kind: 'sam', sel });
    drawStroke(strokes.current[strokes.current.length - 1]);
    setPainted(true);
    redraw();
  };

  /** Semnele, ca listă: „pas înapoi” scoate ultimul și redesenează masca din rest. */
  type Stroke = { kind: 'brush'; r: number; pts: Array<[number, number]> } | { kind: 'sam'; sel: CanvasImageSource };
  const drawStroke = (st: Stroke) => {
    if (!img || !mask.current) return;
    const ctx = mask.current.getContext('2d')!;
    if (st.kind === 'brush') {
      ctx.fillStyle = 'rgb(255,60,90)';
      for (const [x, y] of st.pts) { ctx.beginPath(); ctx.arc(x, y, st.r, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    const [tint, tctx] = canvasOf(img.width, img.height);
    // Puțin mai largă decât obiectul: guma are nevoie de margine ca să nu lase contur.
    const r = Math.max(2, Math.round(Math.max(img.width, img.height) * 0.008));
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
      tctx.drawImage(st.sel, dx, dy, img.width, img.height);
    }
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgb(255,60,90)';
    tctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(tint, 0, 0);
  };
  const undo = () => {
    const m = mask.current;
    if (!m) return;
    strokes.current.pop();
    m.getContext('2d')!.clearRect(0, 0, m.width, m.height);
    strokes.current.forEach(drawStroke);
    setPainted(strokes.current.length > 0);
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
    strokes.current = [];
    const m = mask.current;
    m?.getContext('2d')?.clearRect(0, 0, m.width, m.height);
    setPainted(false);
  };

  /** Pensula: aceeași grosime pe ecran, oricât de mult ai mărit (la zoom, semne mai fine). */
  const paintAt = (el: HTMLCanvasElement, cx: number, cy: number) => {
    if (!mask.current || !img || result) return;
    const box = el.getBoundingClientRect();
    const x = ((cx - box.left) / box.width) * img.width;
    const y = ((cy - box.top) / box.height) * img.height;
    const r = (Math.max(img.width, img.height) * brush) / zoomRef.current.s;
    let st = strokes.current[strokes.current.length - 1];
    if (!st || st.kind !== 'brush' || newStroke.current) { st = { kind: 'brush', r, pts: [] }; strokes.current.push(st); newStroke.current = false; }
    st.pts.push([x, y]);
    drawStroke({ kind: 'brush', r: st.r, pts: [[x, y]] });
    setPainted(true);
    redraw();
  };

  // Degete: unul pictează (doar după ce se mișcă, ca atingerea să rămână „selectează”),
  // două măresc și mută poza.
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      drawing.current = false; down.current = null; pinched.current = true;
      const [a, b] = [...pointers.current.values()];
      const z = zoomRef.current;
      const wrap = e.currentTarget.parentElement!.getBoundingClientRect();
      const ox = wrap.left - z.x, oy = wrap.top - z.y;
      const cx = (a.x + b.x) / 2 - ox, cy = (a.y + b.y) / 2 - oy;
      pinch.current = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), ox, oy, s: z.s, ux: (cx - z.x) / z.s, uy: (cy - z.y) / z.s };
      return;
    }
    if (pinched.current) return;
    drawing.current = true; started.current = false; newStroke.current = true;
    down.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const s = Math.max(1, Math.min(6, (p.s * Math.hypot(a.x - b.x, a.y - b.y)) / p.d));
      const cx = (a.x + b.x) / 2 - p.ox, cy = (a.y + b.y) / 2 - p.oy;
      const z = s === 1 ? { s: 1, x: 0, y: 0 } : { s, x: cx - p.ux * s, y: cy - p.uy * s };
      zoomRef.current = z; setZoom(z);
      return;
    }
    const d = down.current;
    if (!drawing.current || !d) return;
    if (!started.current) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      started.current = true;
      paintAt(e.currentTarget, d.x, d.y);
    }
    paintAt(e.currentTarget, e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0 && pinched.current) { pinched.current = false; drawing.current = false; down.current = null; return; }
    const d = down.current;
    const was = drawing.current && !started.current;
    drawing.current = false; down.current = null;
    if (!was || !d || e.type === 'pointercancel') return;
    // Atingere fără tras: selectează obiectul; fără selecție, lasă un semn de pensulă.
    if (sam === 'ready' && performance.now() - d.t < 450) void tapSelect(e);
    else paintAt(e.currentTarget, d.x, d.y);
  };
  const resetZoom = () => { zoomRef.current = { s: 1, x: 0, y: 0 }; setZoom(zoomRef.current); };

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

  /** Bucata `r` din `src`, cu masca ei, trecută prin AI. Întoarce bucata redesenată (mărimea AI) sau null. */
  const fillRegion = async (src: CanvasImageSource, r: Rect, how: 'native' | 'web' | 'cloud', mode: InpaintMode): Promise<ImageBitmap | HTMLCanvasElement | null> => {
    if (!mask.current) return null;
    const size = aiSize(r.w, r.h);
    const [ic, ictx] = canvasOf(size.width, size.height);
    ictx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, size.width, size.height);
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
    if (how === 'web') return eraseInBrowser(ic, mc).catch(() => null);
    const [imageBlob, maskBlob] = await Promise.all([toBlob(ic, 'image/jpeg', 0.92), toBlob(mc, 'image/png')]);
    if (!imageBlob || !maskBlob) return null;
    const out = how === 'native'
      ? await eraseOnDevice(imageBlob, maskBlob).then(b => (b ? { ok: true as const, image: b } : { ok: false as const }))
      : await cloudInpaint(mode, imageBlob, maskBlob, size.width, size.height);
    return out.ok ? createImageBitmap(out.image) : null;
  };

  /** Bucata redesenată, înapoi în poză: doar unde e masca, cu marginea estompată. */
  const paste = (fctx: CanvasRenderingContext2D, ai: CanvasImageSource, r: Rect) => {
    if (!mask.current) return;
    const [patch, pctx] = canvasOf(r.w, r.h);
    pctx.drawImage(ai, 0, 0, r.w, r.h);
    // Mărită de la mărimea AI, bucata e mai moale decât poza: îi redăm puțină
    // claritate și granulația pozei, ca să nu se vadă o pată netedă.
    const up = r.w / ((ai as { width: number }).width || r.w);
    if (up > 1.3) restoreTexture(pctx, r.w, r.h, Math.min(1, (up - 1) / 2));
    pctx.globalCompositeOperation = 'destination-in';
    pctx.filter = `blur(${Math.max(2, Math.round(Math.max(r.w, r.h) * 0.01))}px)`;
    pctx.drawImage(mask.current, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    pctx.filter = 'none';
    fctx.drawImage(patch, r.x, r.y);
  };

  const run = async (mode: InpaintMode) => {
    if (!img || !mask.current) return;
    setBusy(true);
    try {
      // Guma merge pe telefon (MI-GAN / LaMa), gratuit și fără internet.
      const native = mode === 'erase' && (await onDeviceEditAvailable()).erase;
      // În browser: același tip de model (MI-GAN), rulat în pagină, fără server.
      const web = mode === 'erase' && !native && !Capacitor.isNativePlatform();
      const online = !native && !web && cloudAvailable() && await ensureCloud(askConfirm, tr);
      if (!native && !web && !online) { finishLocal(mode); return; }
      const [final, fctx] = canvasOf(img.width, img.height);
      fctx.drawImage(img, 0, 0);
      if (native || web) {
        // Fiecare zonă marcată separat, cu decupajul ei (~2,2× zona, cu context în jur):
        // un obiect mic rămâne mare în fața modelului, deci chiar dispare.
        const step = 8;
        const s = sampledMask(mask.current, step);
        const zones = maskComponents(s.data, s.w, s.h, 3);
        if (!zones.length) return;
        let done = 0;
        for (const z of zones) {
          const bw = z.w * step, bh = z.h * step;
          // Context în jur: dublu la obiectele mici, mai strâns la cele mari (altfel bucata
          // trece prin AI la 512 px și, mărită înapoi, iese ștearsă — raportat la un balon).
          const big = Math.max(bw, bh);
          const side = Math.min(Math.max(img.width, img.height), Math.max(192, big + 2 * Math.max(48, Math.min(big * 0.6, 280))));
          const w = Math.min(img.width, side), h = Math.min(img.height, side);
          const x = Math.max(0, Math.min(img.width - w, z.x * step + bw / 2 - w / 2));
          const y = Math.max(0, Math.min(img.height - h, z.y * step + bh / 2 - h / 2));
          const r = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
          // Din poza deja curățată: zonele vecine nu-și aduc înapoi obiectele una alteia.
          const ai = await fillRegion(final, r, native ? 'native' : 'web', mode);
          if (ai) { paste(fctx, ai, r); done++; }
        }
        if (!done) { finishLocal(mode); return; }
        setResult(final);
        return;
      }
      let r: Rect = { x: 0, y: 0, w: img.width, h: img.height };
      if (mode === 'erase') {
        const step = 8;
        const s = sampledMask(mask.current, step);
        const b = maskBounds(s.data, s.w, s.h);
        if (!b) return;
        r = { x: b.x * step, y: b.y * step, w: Math.min(img.width - b.x * step, b.w * step), h: Math.min(img.height - b.y * step, b.h * step) };
      }
      const ai = await fillRegion(img, r, 'cloud', mode);
      if (!ai) { finishLocal(mode); return; }
      paste(fctx, ai, r);
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
          <div className="lx-magic-zoom" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }}>
            <canvas ref={view} className="lx-magic-canvas"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          </div>
        )}
        {img && zoom.s > 1 && <button className="lx-magic-zoomreset" onClick={resetZoom}>⤢ {tr('lx.magic.zoomReset')}</button>}
        {busy && <div className="lx-magic-busy"><span className="lx-spinner" />{tr('lx.magic.working')}</div>}
      </div>
      <div className="lx-viewer-info">
        {!result ? (
          <>
            <p className="lx-hint center">{tr(sam === 'ready' ? 'lx.magic.tapHint' : 'lx.magic.eraseHint')}{sam === 'busy' && <> · {tr('lx.magic.tapPreparing')}</>}{sam === 'fail' && <> · {tr('lx.magic.tapFailed')}</>} · {tr('lx.magic.zoomHint')}</p>
            <div className="lx-magic-tools">
              <div className="lx-seg small" role="radiogroup" aria-label={tr('lx.magic.brush')}>
                {[0.014, 0.028, 0.05].map(b => (
                  <button key={b} role="radio" aria-checked={brush === b} className={brush === b ? 'on' : ''} onClick={() => setBrush(b)} aria-label={tr('lx.magic.brush')}>
                    <span className="lx-brush-dot" style={{ width: b * 360, height: b * 360 }} />
                  </button>
                ))}
              </div>
              <button className="lx-btn ghost small" disabled={!painted || busy} onClick={undo}>↶ {tr('lx.magic.undo')}</button>
            </div>
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
