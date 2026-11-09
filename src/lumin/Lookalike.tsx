import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLxPhotos } from './useLxPhotos';
import { loadEditable } from './sharp';
import { shareCollage } from './collage';
import { shareCaption } from './shareCards';
import { saveEditedBlob } from './saveEdited';
import { lookalike, type FaceRef, type LookalikeResult } from './lookalike';
import { useLx } from './lxStore';
import { FaceThumb } from './FaceThumb';
import { usePeopleFaces, type PersonFace } from './faces';

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

/** Fețele oamenilor (din „Oameni”), după nume: pentru alegere și pentru scanare. */
function useFaceMap() {
  const persons = useStore(s => s.persons);
  const faceVersion = useLx(s => s.faceVersion);
  const { people } = usePeopleFaces(persons, faceVersion);
  return useMemo(() => new Map(people.map(p => [p.name, p])), [people]);
}

function FaceDot({ name, faces, size, className, onClick, on }: { name: string; faces: Map<string, PersonFace>; size: number; className?: string; onClick?: () => void; on?: boolean }) {
  const f = faces.get(name);
  const inner = f ? <FaceThumb photoId={f.photoId} box={f.box} size={size} className="lx-face-img" /> : <span className="lx-look-noface" style={{ width: size, height: size }}>{name.charAt(0)}</span>;
  return onClick
    ? <button className={`lx-look-face${on ? ' on' : ''}${className ? ` ${className}` : ''}`} onClick={onClick} aria-pressed={on}>{inner}<b>{name}</b></button>
    : <span className={`lx-look-face${className ? ` ${className}` : ''}`}>{inner}<b>{name}</b></span>;
}

/**
 * Scanarea: fața omului într-un inel care se rotește, o linie de scanare care o
 * parcurge, punctele trăsăturilor care pulsează și procentele care „caută” până
 * vine rezultatul. Cel puțin câteva secunde, ca să se vadă (cerut: „animație
 * futuristă de scanare, apoi rezultatul”).
 */
function ScanView({ name, others, faces }: { name: string; others: string[]; faces: Map<string, PersonFace> }) {
  const tr = useTr();
  const [step, setStep] = useState(0);
  const [nums, setNums] = useState<number[]>(others.map(() => 0));
  useEffect(() => {
    const a = window.setInterval(() => setStep(x => x + 1), 950);
    const b = window.setInterval(() => setNums(others.map(() => Math.floor(10 + Math.random() * 80))), 90);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, [others]);
  const steps = [tr('lx.look.scan.detect'), tr('lx.look.scan.eyes'), tr('lx.look.scan.shape'), ...others.map(o => tr('lx.look.scan.compare', { name: o })), tr('lx.look.scan.calc')];
  return (
    <div className="lx-scan">
      <div className="lx-scan-target">
        <span className="lx-scan-ring" aria-hidden="true" />
        <span className="lx-scan-hud" aria-hidden="true"><i /><i /><i /><i /></span>
        <FaceDot name={name} faces={faces} size={190} className="big" />
        <span className="lx-scan-line" aria-hidden="true" />
        <svg className="lx-scan-mesh" viewBox="0 0 100 100" aria-hidden="true">
          <polyline points="34,42 50,36 66,42 62,72 50,78 38,72 34,42" />
          <polyline points="34,42 50,58 66,42 M50,58 50,36 M38,72 50,58 62,72" />
          {[[34, 42], [66, 42], [50, 58], [38, 72], [62, 72], [50, 36], [50, 78]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.8" style={{ animationDelay: `${i * 0.18}s` }} />)}
        </svg>
      </div>
      <p className="lx-scan-step">{steps[step % steps.length]}</p>
      <div className="lx-scan-others">
        {others.map((o, i) => (
          <div key={o} className="lx-scan-other" style={{ animationDelay: `${i * 0.25}s` }}>
            <FaceDot name={o} faces={faces} size={64} />
            <span className="lx-scan-pct">{nums[i] ?? 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LookalikeSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const tr = useTr();
  const people = usePeopleByCount();
  const faces = useFaceMap();
  const suggested = useCompanions(name);
  const [others, setOthers] = useState<string[] | null>(null);
  const chosen = others ?? suggested;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pick' | 'scan' | 'done' | 'none'>('pick');
  const scan = () => {
    if (!chosen.length) return;
    setPhase('scan'); setBlob(null); setUrl(null);
    const t0 = performance.now();
    void (async () => {
      const { results, enough, faces: nFaces, dims } = await lookalike(name, chosen);
      const b = enough ? await renderCard(name, results, { title: tr('lx.look.cardTitle', { name }), pair: tr('lx.look.pair'), note: tr('lx.look.noteData', { faces: nFaces, dims }) }) : null;
      // Scanarea se vede cel puțin 4 secunde, chiar dacă rezultatul vine mai repede.
      const wait = 4200 - (performance.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (!b) { setPhase('none'); return; }
      setBlob(b); setUrl(URL.createObjectURL(b)); setPhase('done');
      try { navigator.vibrate?.([12, 60, 24]); } catch { /* fără */ }
    })();
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const toggle = (n: string) => setOthers(cur => {
    const base = cur ?? suggested;
    return base.includes(n) ? base.filter(x => x !== n) : base.length >= 3 ? [...base.slice(1), n] : [...base, n];
  });
  return createPortal(
    <div className="lx lx-enhance lx-film lx-look" role="dialog" aria-modal="true" aria-label={tr('lx.look.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.look.cardTitle', { name })}</span>
        <span />
      </header>
      {phase === 'pick' && (
        <div className="lx-fm-body lx-look-pick">
          <FaceDot name={name} faces={faces} size={150} className="big" />
          <p className="lx-hint center">{tr('lx.look.pickWho')}</p>
          <p className="lx-look-how">{tr('lx.look.how')}</p>
          <div className="lx-look-grid">
            {people.filter(p => p !== name).slice(0, 12).map(p => <FaceDot key={p} name={p} faces={faces} size={72} on={chosen.includes(p)} onClick={() => toggle(p)} />)}
          </div>
        </div>
      )}
      {phase === 'scan' && <ScanView name={name} others={chosen} faces={faces} />}
      {phase === 'done' && url && <div className="lx-enhance-stage lx-look-result"><img className="lx-film-video" src={url} alt="" /></div>}
      {phase === 'none' && <div className="lx-enhance-stage"><p className="lx-empty">{tr('lx.look.none', { name })}</p></div>}
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          {phase === 'pick' && <button className="lx-btn primary lx-scan-btn" disabled={!chosen.length} onClick={scan}>◎ {tr('lx.look.scanBtn')}</button>}
          {(phase === 'done' || phase === 'none') && <button className="lx-btn ghost" onClick={() => setPhase('pick')}>{tr('lx.look.again')}</button>}
          {phase === 'done' && (
            <>
              <button className="lx-btn ghost" disabled={!blob} onClick={() => blob && void saveEditedBlob(blob, 'semeni').then(ok => useStore.getState().setNotice(tr(ok ? 'lx.profile.saved' : 'lx.magic.failed')))}>{tr('lx.burstFilm.save')}</button>
              <button className="lx-btn primary" disabled={!blob} onClick={() => blob && void shareCollage(blob, `cherrypic-semeni-${Date.now()}.jpg`, shareCaption(tr('lx.look.shareText', { name }), tr('lx.share.cta')))}>↗ {tr('lx.wall.share')}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
