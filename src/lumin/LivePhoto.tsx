import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';
import { FilmSheet } from './FilmSheet';
import type { BurstFilm } from './burstFilm';
import { prepareLivePhoto, recordLivePhoto, type LiveMotion, type LiveRenderer } from './livePhoto';
import { MUSIC_MOODS, type MusicMood } from './storyMusic';
import { logError } from '../core/errorLog';
import { useHoldAnalysis } from './useHoldAnalysis';

/** „Poza vie”: alegi mișcarea și o vezi pe loc, apoi o faci film (salvat sau trimis). */
export function LivePhotoSheet({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  useHoldAnalysis();
  const tr = useTr();
  const stage = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState<LiveMotion>('orbit');
  const [strong, setStrong] = useState(false);
  const [music, setMusic] = useState<'none' | MusicMood>('calm');
  const [renderer, setRenderer] = useState<LiveRenderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [film, setFilm] = useState<BurstFilm | null>(null);

  useEffect(() => {
    let alive = true;
    setRenderer(null);
    prepareLivePhoto(photoId, motion, strong ? 1.8 : 1).then(r => { if (alive) { if (r) setRenderer(r); else setFailed(true); } }, e => {
      logError('live', e instanceof Error ? e.message : String(e), 'LivePhoto');
      if (alive) setFailed(true);
    });
    return () => { alive = false; };
  }, [photoId, motion, strong]);

  // Previzualizarea: bucla rulează cât e deschisă (și nu se înregistrează).
  useEffect(() => {
    const host = stage.current;
    if (!renderer || !host || busy) return;
    renderer.canvas.className = 'lx-film-video';
    host.replaceChildren(renderer.canvas);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => { renderer.render(((now - t0) / 4000) % 1); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [renderer, busy]);

  const make = async () => {
    if (!renderer) return;
    setBusy(true); setPct(0);
    try {
      const f = await recordLivePhoto(renderer, music, setPct);
      if (f) setFilm(f); else useStore.getState().setNotice(tr('lx.magic.failed'));
    } finally { setBusy(false); setPct(0); }
  };

  const chips = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <div className="lx-fm-opt">
      <span>{label}</span>
      <div className="lx-enhance-styles" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'lx-chip-btn on' : 'lx-chip-btn'} disabled={busy} onClick={() => set(v)}>{l}</button>)}
      </div>
    </div>
  );

  return createPortal(
    <div className="lx lx-enhance lx-film lx-live" role="dialog" aria-modal="true" aria-label={tr('lx.live.title')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.live.title')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage" ref={stage}>
        {failed ? <p className="lx-empty">{tr('lx.live.failed')}</p> : !renderer && <div className="lx-enhance-wait"><span className="lx-spinner" />{tr('lx.live.working')}</div>}
      </div>
      <div className="lx-viewer-info lx-live-opts">
        {chips(tr('lx.live.motion'), motion, setMotion, [['orbit', tr('lx.live.orbit')], ['zoom', tr('lx.live.zoom')], ['sway', tr('lx.live.sway')]])}
        {chips(tr('lx.live.strength'), strong ? 'strong' : 'soft', v => setStrong(v === 'strong'), [['soft', tr('lx.live.soft')], ['strong', tr('lx.live.strong')]])}
        {chips(tr('lx.filmMaker.music'), music, setMusic, [...MUSIC_MOODS.map(m => [m, tr(`lx.filmMaker.music.${m}`)] as [MusicMood, string]), ['none', tr('lx.filmMaker.music.none')]])}
        <div className="lx-decide-actions">
          <button className={busy ? 'lx-btn primary lx-busy-btn' : 'lx-btn primary'} style={busy ? { ['--pct' as string]: `${Math.round(pct * 100)}%` } : undefined}
            disabled={!renderer || busy} onClick={() => void make()}>
            <Icon name="film" size={18} /> {busy ? `${tr('lx.filmMaker.making')} · ${Math.round(pct * 100)}%` : tr('lx.live.make')}
          </button>
        </div>
      </div>
      {film && <FilmSheet film={film} onClose={() => setFilm(null)} />}
    </div>,
    document.body
  );
}
