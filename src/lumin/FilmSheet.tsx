import { useEffect, useRef, useState } from 'react';
import { appCaption } from './shareCards';
import type { BurstFilm } from './burstFilm';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { useTr } from './context';
import { shareCollage } from './collage';
import { saveEditedBlob } from './saveEdited';
import { startStoryMusic } from './storyMusic';
import { useHoldAnalysis } from './useHoldAnalysis';

/**
 * Mini-filmul din serie, văzut întâi în aplicație (în buclă), apoi salvat în
 * galerie sau trimis. Înainte se deschidea direct fereastra de partajare.
 */
export function FilmSheet({ film, onClose }: { film: BurstFilm; onClose: () => void }) {
  useHoldAnalysis();
  const tr = useTr();
  const setNotice = useStore(s => s.setNotice);
  const [busy, setBusy] = useState(false);
  // Redat din cadre, pe canvas: WebView-ul nu putea reda fișierul video (raportat:
  // „nu poți da play în aplicație”). Fișierul rămâne pentru salvare și trimitere.
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !film.count) return;
    c.width = film.width; c.height = film.height;
    const ctx = c.getContext('2d')!;
    let i = 0;
    const id = window.setInterval(() => { film.draw(ctx, i); i++; }, 1000 / film.fps);
    // Muzica se aude și aici, cât rulează filmul (până la 10 minute).
    const music = film.music !== 'none' ? startStoryMusic(600_000, { mood: film.music, speakers: true }) : null;
    return () => { window.clearInterval(id); music?.stop(); };
  }, [film]);
  const name = `cherrypic-miscare-${Date.now()}.${film.ext}`;
  const save = async () => {
    setBusy(true);
    try {
      const ok = await saveEditedBlob(film.blob, 'miscare', film.ext);
      setNotice(tr(ok ? 'lx.burstFilm.saved' : 'lx.magic.failed'));
      if (ok) onClose();
    } finally { setBusy(false); }
  };
  return createPortal(
    <div className="lx lx-enhance lx-film" role="dialog" aria-modal="true" aria-label={tr('lx.burstFilm.button')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.burstFilm.button')}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        <canvas ref={canvas} className="lx-film-video" />
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" disabled={busy} onClick={() => void shareCollage(film.blob, name, appCaption('', tr('lx.share.cta')))}>↗ {tr('lx.wall.share')}</button>
          <button className="lx-btn primary" disabled={busy} onClick={() => void save()}>{tr('lx.burstFilm.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
