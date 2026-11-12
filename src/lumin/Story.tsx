import { useEffect, useRef, useState } from 'react';
import { appCaption } from './shareCards';
import { createPortal } from 'react-dom';
import { isRecapVideoSupported } from '../core/recapVideoRender';
import { useStore } from '../state/store';
import { shareCollage } from './collage';
import { useTr } from './context';
import { MIN_STORY_PHOTOS, renderStory } from './storyVideo';
import { saveEditedBlob } from './saveEdited';
import { useHoldAnalysis } from './useHoldAnalysis';

/**
 * Filmul se înregistrează direct ca mp4 (H.264) unde WebView-ul știe — toate
 * telefoanele cu WebView la zi (core/recapVideoRender.ts: PREFERRED_TYPES).
 * Pe cele vechi iese WebM. O conversie pe telefon (Media3) ar fi adăugat câțiva
 * MB la aplicație pentru puțini oameni, așa că nu.
 */
async function shareFilm(blob: Blob, ext: string, base: string, title: string): Promise<void> {
  await shareCollage(blob, `${base}.${ext}`, title);
}

export function StoryButton({ ids, title, subtitle, className = 'lx-link' }: { ids: string[]; title: string; subtitle: string; className?: string }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (ids.length < MIN_STORY_PHOTOS || !isRecapVideoSupported()) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>▶ {tr('lx.story.make')}</button>
      {open && <StoryPreview ids={ids} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Filmul se vede pe ecran chiar cât se face (se înregistrează în timp real), apoi:
 * „Din nou” (îl mai vezi o dată), „Salvează în galerie” sau „Trimite”.
 * Cerut: „filmele să le poți vedea pe telefon înainte de salvare sau trimitere”.
 */
function StoryPreview({ ids, title, subtitle, onClose }: { ids: string[]; title: string; subtitle: string; onClose: () => void }) {
  useHoldAnalysis();
  const tr = useTr();
  const setNotice = useStore(s => s.setNotice);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cancelled = useRef(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'making' | 'ready' | 'replay'>('making');
  const [film, setFilm] = useState<{ blob: Blob; ext: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `cherrypic-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'film'}`;
  const input = { ids, title, subtitle, branded: useStore.getState().premiumLocked };

  useEffect(() => {
    cancelled.current = false;
    void (async () => {
      try {
        const r = await renderStory(input, setProgress, () => cancelled.current, { canvas: canvas.current ?? undefined });
        if (cancelled.current) return;
        if (!r) { setNotice(tr('lx.story.failed')); onClose(); return; }
        setFilm(r); setPhase('ready');
      } catch {
        setNotice(tr('lx.story.failed')); onClose();
      }
    })();
    return () => { cancelled.current = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const replay = async () => {
    setPhase('replay'); setProgress(0);
    await renderStory(input, setProgress, () => cancelled.current, { canvas: canvas.current ?? undefined, record: false }).catch(() => null);
    if (!cancelled.current) setPhase('ready');
  };
  const save = async () => {
    if (!film) return;
    setBusy(true);
    try {
      const ok = await saveEditedBlob(film.blob, 'film', film.ext);
      setNotice(tr(ok ? 'lx.burstFilm.saved' : 'lx.magic.failed'));
    } finally { setBusy(false); }
  };
  const close = () => { cancelled.current = true; onClose(); };

  return createPortal(
    <div className="lx lx-enhance lx-story-preview" role="dialog" aria-modal="true" aria-label={title}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={close} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{title}</span>
        <span />
      </header>
      <div className="lx-enhance-stage">
        <canvas ref={canvas} className="lx-story-canvas" />
        {phase !== 'ready' && <div className="lx-story-bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      </div>
      <div className="lx-viewer-info">
        <p className="lx-hint center">{tr(phase === 'making' ? 'lx.story.makingLive' : phase === 'replay' ? 'lx.story.replaying' : 'lx.story.readyHint')}</p>
        <div className="lx-decide-actions">
          {phase === 'making' ? (
            <button className="lx-btn ghost" onClick={close}>{tr('lx.story.stop')}</button>
          ) : (
            <>
              <button className="lx-btn ghost" disabled={phase === 'replay' || busy} onClick={() => void replay()}>↻ {tr('lx.story.again')}</button>
              <button className="lx-btn ghost" disabled={!film || busy} onClick={() => film && void shareFilm(film.blob, film.ext, base, appCaption(title, tr('lx.share.cta')))}>↗ {tr('lx.wall.share')}</button>
              <button className="lx-btn primary" disabled={!film || busy} onClick={() => void save()}>{tr('lx.burstFilm.save')}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
