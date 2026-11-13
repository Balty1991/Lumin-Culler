import { useEffect, useMemo, useRef, useState } from 'react';
import { maybeAskForReview } from '../state/reviewPrompt';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { useLxPhotos } from './useLxPhotos';
import { Thumb } from './Thumb';
import { loadImage, shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { appCaption } from './shareCards';
import { learnFromShare } from './signals';
import { useHoldAnalysis } from './useHoldAnalysis';
import { photoTime } from './days';
import {
  COLLAGE_BGS, COLLAGE_FORMATS, COLLAGE_MODELS, MODEL_MAX, collageBlob, formatSize, renderCollage,
  type CollageModel, type CollageOptions
} from './collageStudio';

/**
 * lumin/CollageCreator.tsx
 * Creatorul de colaje din Studio (cerut: „ceva foarte modern, atractiv, complex”):
 * șapte modele cu previzualizare vie, format (4:5, story, pătrat), fundal, spațiere, colțuri,
 * titlu, amestecare și alegerea pozelor. Pornește singur cu cele mai bune poze din ultima lună.
 */
type Pic = HTMLImageElement;

function defaultTitle(locale: string): string {
  try { return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date()).replace(/^./, c => c.toUpperCase()); } catch { return ''; }
}

export function CollageCreator({ onClose, initialIds, initialTitle, sendAllLabel }: { onClose: () => void; initialIds?: string[]; initialTitle?: string; sendAllLabel?: boolean }) {
  useHoldAnalysis();
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const all = useLxPhotos();
  const pool = useMemo(() => {
    const kept = all.filter(p => !p.aside && p.status !== 'rejected' && p.mediaUri);
    return [...kept].sort((a, b) =>
      (b.status === 'selected' ? 1 : 0) - (a.status === 'selected' ? 1 : 0)
      || photoTime(b) - photoTime(a));
  }, [all]);
  const [ids, setIds] = useState<string[]>(() => {
    if (initialIds?.length) return initialIds;
    const month = Date.now() - 31 * 86_400_000;
    const recent = pool.filter(p => photoTime(p) >= month);
    const src = recent.length >= 4 ? recent : pool;
    return [...src].sort((a, b) => ((b.faceCount ?? 0) > 0 ? 1 : 0) - ((a.faceCount ?? 0) > 0 ? 1 : 0) || b.aiScore - a.aiScore).slice(0, 12).map(p => p.id);
  });
  const [opts, setOpts] = useState<CollageOptions>({ model: 'bento', format: 'portrait', bg: 'blur', gap: 0.4, radius: 0.5, title: initialTitle ?? defaultTitle(locale), subtitle: '' });
  const [imgs, setImgs] = useState<Pic[]>([]);
  const cache = useRef(new Map<string, Pic>());
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<CollageModel, string>>>({});

  // Pozele, încărcate o dată (cache), în ordinea aleasă.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Pic[] = [];
      for (const id of ids) {
        let img = cache.current.get(id);
        if (!img) { const got = await loadImage(id); if (got) { img = got; cache.current.set(id, got); } }
        if (img) out.push(img);
        if (!alive) return;
      }
      if (alive) setImgs(out);
    })();
    return () => { alive = false; };
  }, [ids]);

  // Previzualizarea mare: la jumătate din mărimea finală, redesenată pe cadru.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !imgs.length) return;
    const frame = requestAnimationFrame(() => {
      const { w, h } = formatSize(opts.format);
      const k = 0.5;
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      const ctx = c.getContext('2d');
      if (ctx) renderCollage(ctx, c.width, c.height, imgs, opts);
    });
    return () => cancelAnimationFrame(frame);
  }, [imgs, opts]);

  // Miniaturile modelelor (cu pozele tale), refăcute când se schimbă pozele sau fundalul.
  useEffect(() => {
    if (!imgs.length) return;
    let alive = true;
    const urls: string[] = [];
    const t = window.setTimeout(() => {
      const next: Partial<Record<CollageModel, string>> = {};
      for (const m of COLLAGE_MODELS) {
        const c = document.createElement('canvas');
        const { w, h } = formatSize(opts.format);
        c.width = 150; c.height = Math.round(150 * h / w);
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        renderCollage(ctx, c.width, c.height, imgs, { ...opts, model: m, title: '', subtitle: '' });
        const u = c.toDataURL('image/jpeg', 0.7);
        urls.push(u);
        next[m] = u;
      }
      if (alive) setThumbs(next);
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [imgs, opts.format, opts.bg, opts.gap, opts.radius]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof CollageOptions>(key: K, value: CollageOptions[K]) => setOpts(o => ({ ...o, [key]: value }));
  const used = ids.slice(0, MODEL_MAX[opts.model]);
  const shuffle = () => setIds(list => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  });

  const make = () => collageBlob(imgs, opts);
  const save = async () => {
    setBusy(true);
    try {
      const blob = await make();
      const ok = blob ? await saveEditedBlob(blob, 'colaj') : false;
      useStore.getState().setNotice(tr(ok ? 'lx.collage.saved' : 'lx.collage.saveFailed'));
      if (ok) { void learnFromShare(pool.filter(p => used.includes(p.id))); maybeAskForReview(1); }
    } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const blob = await make();
      if (!blob) return;
      await shareCollage(blob, `cherrypic-colaj-${Date.now()}.jpg`, appCaption(opts.title, tr('lx.share.cta')));
      void learnFromShare(pool.filter(p => used.includes(p.id)));
      // Primul colaj trimis e un „wow”: momentul bun pentru recenzie (o singură dată).
      maybeAskForReview(1);
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-cc" role="dialog" aria-modal="true" aria-label={tr('lx.cc.title')}>
      <header className="lx-cc-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <b>{tr('lx.cc.title')}</b>
        <button className="lx-chip-btn" onClick={shuffle} disabled={ids.length < 2}>🔀 {tr('lx.cc.shuffle')}</button>
      </header>
      <div className="lx-cc-stage">
        {imgs.length ? <canvas ref={canvas} className={`lx-cc-canvas f-${opts.format}`} /> : <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.cc.loading')}</div>}
      </div>
      <div className="lx-cc-panel">
        <div className="lx-cc-models" role="radiogroup" aria-label={tr('lx.cc.model')}>
          {COLLAGE_MODELS.map(m => (
            <button key={m} role="radio" aria-checked={opts.model === m} className={opts.model === m ? 'on' : ''} onClick={() => set('model', m)}>
              <span className={`lx-cc-mthumb f-${opts.format}`}>{thumbs[m] ? <img src={thumbs[m]} alt="" /> : <i className="lx-spinner" />}</span>
              <small>{tr(`lx.cc.m.${m}`)}</small>
            </button>
          ))}
        </div>
        <div className="lx-cc-row">
          <span>{tr('lx.cc.format')}</span>
          <div className="lx-seg">
            {COLLAGE_FORMATS.map(f => <button key={f} className={opts.format === f ? 'on' : ''} onClick={() => set('format', f)}>{tr(`lx.cc.f.${f}`)}</button>)}
          </div>
        </div>
        <div className="lx-cc-row">
          <span>{tr('lx.cc.bg')}</span>
          <div className="lx-seg">
            {COLLAGE_BGS.map(b => <button key={b} className={opts.bg === b ? 'on' : ''} onClick={() => set('bg', b)}>{tr(`lx.cc.b.${b}`)}</button>)}
          </div>
        </div>
        <label className="lx-cc-slider"><span>{tr('lx.cc.gap')}</span><input type="range" min={0} max={100} value={Math.round(opts.gap * 100)} onChange={e => set('gap', Number(e.target.value) / 100)} /></label>
        <label className="lx-cc-slider"><span>{tr('lx.cc.radius')}</span><input type="range" min={0} max={100} value={Math.round(opts.radius * 100)} onChange={e => set('radius', Number(e.target.value) / 100)} /></label>
        <input className="lx-cc-text" value={opts.title} maxLength={40} placeholder={tr('lx.cc.titlePh')} onChange={e => set('title', e.target.value)} />
        <input className="lx-cc-text small" value={opts.subtitle} maxLength={60} placeholder={tr('lx.cc.subPh')} onChange={e => set('subtitle', e.target.value)} />
        {sendAllLabel && ids.length > 0 && (
          <button className="lx-btn ghost wide" disabled={busy} onClick={() => void useStore.getState().exportSelection('apps', ids)}>📤 {tr('lx.cc.sendAll', { count: ids.length })}</button>
        )}
        <button className="lx-btn ghost wide" onClick={() => setPicking(true)}>🖼️ {tr('lx.cc.pick', { count: used.length })}</button>
        <div className="lx-decide-actions lx-cc-actions">
          <button className="lx-btn ghost" disabled={busy || !imgs.length} onClick={() => void save()}>{tr('lx.collage.save')}</button>
          <button className="lx-btn primary" disabled={busy || !imgs.length} onClick={() => void send()}>{tr('lx.collage.send')}</button>
        </div>
      </div>
      {picking && <PhotoPicker pool={pool} chosen={ids} max={MODEL_MAX[opts.model]} onDone={next => { if (next.length) setIds(next); setPicking(false); }} />}
    </div>,
    document.body
  );
}

/** Alegerea pozelor: atingi în ordinea în care vrei să apară. */
function PhotoPicker({ pool, chosen, max, onDone }: { pool: ReturnType<typeof useLxPhotos>; chosen: string[]; max: number; onDone: (ids: string[]) => void }) {
  const tr = useTr();
  const [sel, setSel] = useState<string[]>(chosen.slice(0, max));
  const toggle = (id: string) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= 12 ? s : [...s, id]));
  return (
    <div className="lx-cc-picker">
      <header className="lx-cc-top">
        <button className="lx-icon-btn" onClick={() => onDone([])} aria-label={tr('lx.close')}>✕</button>
        <b>{tr('lx.cc.pickTitle', { count: sel.length })}</b>
        <button className="lx-btn primary small" onClick={() => onDone(sel)} disabled={!sel.length}>{tr('lx.cc.done')}</button>
      </header>
      <p className="lx-hint">{tr('lx.cc.pickHint', { count: max })}</p>
      <div className="lx-cc-grid">
        {pool.slice(0, 400).map(p => {
          const i = sel.indexOf(p.id);
          return (
            <button key={p.id} className={i >= 0 ? 'on' : ''} onClick={() => toggle(p.id)}>
              <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
              {i >= 0 && <em>{i + 1}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
