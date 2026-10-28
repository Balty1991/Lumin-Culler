import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isRecapVideoSupported } from '../core/recapVideoRender';
import { useStore } from '../state/store';
import { shareCollage } from './collage';
import { useTr } from './context';
import { MIN_STORY_PHOTOS, renderStory } from './storyVideo';

/**
 * lumin/Story.tsx
 * Butonul „Film” — face povestea video din pozele date și o deschide în foaia
 * de partajare a telefonului. Filmul se face în timp real (câteva secunde),
 * cu progres pe tot ecranul și „Oprește”.
 */
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
      const r = await renderStory({ ids, title, subtitle }, setProgress, () => cancelled.current);
      if (!r) return;
      const name = `lumin-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poveste'}.${r.ext}`;
      setProgress(null);
      await shareCollage(r.blob, name, title);
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
