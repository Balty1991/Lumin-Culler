import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isRecapVideoSupported } from '../core/recapVideoRender';
import { useStore } from '../state/store';
import { shareCollage } from './collage';
import { useTr } from './context';
import { MIN_STORY_PHOTOS, renderStory } from './storyVideo';

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
  const setNotice = useStore(s => s.setNotice);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);
  if (ids.length < MIN_STORY_PHOTOS || !isRecapVideoSupported()) return null;

  const make = async () => {
    cancelled.current = false;
    setProgress(0);
    try {
      const r = await renderStory({ ids, title, subtitle, branded: useStore.getState().premiumLocked }, setProgress, () => cancelled.current);
      if (!r) return;
      const base = `lumin-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poveste'}`;
      setProgress(null);
      await shareFilm(r.blob, r.ext, base, title);
    } catch {
      setNotice(tr('lx.story.failed'));
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <button className={className} onClick={() => void make()} disabled={progress !== null}>▶ {tr('lx.story.make')}</button>
      {progress !== null && createPortal(
        <div className="lx lx-story-busy" role="status">
          <div className="lx-story-ring" style={{ ['--p' as string]: `${Math.round(progress * 100)}` }}><b>{Math.round(progress * 100)}%</b></div>
          <p>{tr('lx.story.making')}</p>
          <button className="lx-btn ghost" onClick={() => { cancelled.current = true; }}>{tr('lx.story.stop')}</button>
        </div>,
        document.body
      )}
    </>
  );
}
