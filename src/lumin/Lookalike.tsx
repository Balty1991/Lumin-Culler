import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLxPhotos } from './useLxPhotos';
import { loadEditable } from './sharp';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { lookalike, type FaceRef, type LookalikeResult } from './lookalike';

/**
 * lumin/Lookalike.tsx
 * „Cu cine semeni?”: alegi un om (copilul) și cu cine să fie comparat (de obicei
 * părinții, propuși după pozele împreună). Iese un card 9:16, gata de WhatsApp
 * Status: fețele, procentele și perechea de poze cea mai asemănătoare.
 */
const W = 1080, H = 1920;

async function faceCanvas(f: FaceRef, size: number): Promise<HTMLCanvasElement | null> {
  const r = await loadEditable(f.photoId, 1440).catch(() => null);
  if (!r?.img) return null;
  const img = r.img, iw = img.naturalWidth, ih = img.naturalHeight;
  const [bx, by, bw, bh] = f.box;
  const side = Math.min(Math.max(bw * iw, bh * ih) * 1.7, iw, ih);
  const cx = (bx + bw / 2) * iw, cy = (by + bh / 2) * ih;
  const x = Math.max(0, Math.min(iw - side, cx - side / 2)), y = Math.max(0, Math.min(ih - side, cy - side / 2));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, side, side, 0, 0, size, size);
  return c;
}

function circle(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement | null, cx: number, cy: number, r: number, ring: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#1a1016'; ctx.fill();
  ctx.clip();
  if (src) ctx.drawImage(src, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.lineWidth = 10; ctx.strokeStyle = ring;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

async function renderCard(name: string, results: LookalikeResult[], t: { title: string; pair: string; note: string }): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#050305'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 560, 0, W / 2, 560, 900);
  g.addColorStop(0, 'rgba(255,46,110,0.38)'); g.addColorStop(1, 'rgba(255,46,110,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const font = 'system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff6f9'; ctx.font = `800 70px ${font}`;
  ctx.fillText(t.title, W / 2, 170);
  const top = results.slice(0, 3);
  const best = top[0];
  // Fața omului, mare, sus.
  const childFace = best?.best ? await faceCanvas(best.best.child, 520) : null;
  circle(ctx, childFace, W / 2, 470, 220, '#ff4f7f');
  ctx.fillStyle = '#fff6f9'; ctx.font = `800 56px ${font}`;
  ctx.fillText(name, W / 2, 760);
  // Cei comparați: fața, numele și procentul, cu bară.
  const n = top.length;
  for (let i = 0; i < n; i++) {
    const r = top[i];
    const cx = W * (i + 1) / (n + 1);
    const face = r.best ? await faceCanvas(r.best.other, 300) : null;
    circle(ctx, face, cx, 960, 120, i === 0 ? '#ffb3c8' : 'rgba(255,255,255,0.35)');
    ctx.fillStyle = i === 0 ? '#ff4f7f' : '#fff6f9'; ctx.font = `900 ${i === 0 ? 96 : 76}px ${font}`;
    ctx.fillText(`${r.percent}%`, cx, 1190);
    ctx.fillStyle = '#c9b4bf'; ctx.font = `600 40px ${font}`;
    ctx.fillText(r.name, cx, 1250);
  }
  // Perechea cea mai asemănătoare: cele două fețe una lângă alta.
  if (best?.best) {
    ctx.fillStyle = '#ff8fae'; ctx.font = `700 36px ${font}`;
    ctx.fillText(t.pair, W / 2, 1380);
    const a = await faceCanvas(best.best.child, 420), b = await faceCanvas(best.best.other, 420);
    const s = 360, y = 1420;
    for (const [img, x] of [[a, W / 2 - s - 12], [b, W / 2 + 12]] as const) {
      ctx.save();
      const rr = 40;
      ctx.beginPath();
      ctx.moveTo(x + rr, y); ctx.arcTo(x + s, y, x + s, y + s, rr); ctx.arcTo(x + s, y + s, x, y + s, rr); ctx.arcTo(x, y + s, x, y, rr); ctx.arcTo(x, y, x + s, y, rr);
      ctx.closePath(); ctx.clip();
      if (img) ctx.drawImage(img, x, y, s, s);
      ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(255,246,249,0.55)'; ctx.font = `500 28px ${font}`;
  ctx.fillText(t.note, W / 2, 1870);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}

/** Oamenii cu fețe recunoscute, cei mai des fotografiați întâi. */
function usePeopleByCount(): string[] {
  const photos = useLxPhotos();
  return useMemo(() => {
    const n = new Map<string, number>();
    for (const p of photos) for (const name of p.personNames ?? []) n.set(name, (n.get(name) ?? 0) + 1);
    return [...n.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [photos]);
}

/** Cu cine apare cel mai des (de obicei părinții): propunerea de comparat. */
function useCompanions(name: string | null): string[] {
  const photos = useLxPhotos();
  return useMemo(() => {
    if (!name) return [];
    const n = new Map<string, number>();
    for (const p of photos) if (p.personNames?.includes(name)) for (const o of p.personNames) if (o !== name) n.set(o, (n.get(o) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  }, [photos, name]);
}

export function LookalikeCard() {
  const tr = useTr();
  const people = usePeopleByCount();
  const [open, setOpen] = useState<string | null>(null);
  if (people.length < 2) return null;
  return (
    <section className="lx-card lx-growth-card">
      <span className="lx-profile-badge" aria-hidden="true">≈</span>
      <div>
        <b>{tr('lx.look.title')}</b>
        <small>{tr('lx.look.sub')}</small>
        <div className="lx-chips">
          {people.slice(0, 4).map(n => <button key={n} className="lx-chip-btn" onClick={() => setOpen(n)}>{n}</button>)}
        </div>
      </div>
      {open && <LookalikeSheet name={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function LookalikeSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const tr = useTr();
  const people = usePeopleByCount();
  const suggested = useCompanions(name);
  const [others, setOthers] = useState<string[] | null>(null);
  const chosen = others ?? suggested;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'work' | 'none' | 'done'>('work');
  const key = chosen.join('|');
  useEffect(() => {
    if (!chosen.length) { setState('none'); return; }
    let alive = true;
    setState('work'); setBlob(null); setUrl(null);
    void (async () => {
      const { results, enough } = await lookalike(name, chosen);
      if (!alive) return;
      if (!enough) { setState('none'); return; }
      const b = await renderCard(name, results, { title: tr('lx.look.cardTitle', { name }), pair: tr('lx.look.pair'), note: tr('lx.look.note') });
      if (!alive || !b) return;
      setBlob(b); setUrl(URL.createObjectURL(b)); setState('done');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const toggle = (n: string) => setOthers(cur => {
    const base = cur ?? suggested;
    return base.includes(n) ? base.filter(x => x !== n) : base.length >= 3 ? [...base.slice(1), n] : [...base, n];
  });
  return createPortal(
    <div className="lx lx-enhance lx-film" role="dialog" aria-modal="true" aria-label={tr('lx.look.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.look.cardTitle', { name })}</span>
        <span />
      </header>
      <div className="lx-enhance-styles lx-profile-modes" role="group" aria-label={tr('lx.look.compare')}>
        {people.filter(p => p !== name).slice(0, 8).map(p => (
          <button key={p} className={chosen.includes(p) ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => toggle(p)}>{p}</button>
        ))}
      </div>
      <div className="lx-enhance-stage">
        {state === 'done' && url ? <img className="lx-film-video" src={url} alt="" />
          : state === 'none' ? <p className="lx-empty">{tr('lx.look.none', { name })}</p>
          : <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.look.working')}</div>}
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" disabled={!blob} onClick={() => blob && void saveEditedBlob(blob, 'semeni').then(ok => useStore.getState().setNotice(tr(ok ? 'lx.profile.saved' : 'lx.magic.failed')))}>{tr('lx.burstFilm.save')}</button>
          <button className="lx-btn primary" disabled={!blob} onClick={() => blob && void shareCollage(blob, `cherrypic-semeni-${Date.now()}.jpg`, tr('lx.look.shareText', { name }))}>↗ {tr('lx.wall.share')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
