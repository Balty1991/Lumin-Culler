import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isRecapVideoSupported } from '../core/recapVideoRender';
import { useStore } from '../state/store';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { blobToBase64, shareCollage } from './collage';

const VideoConvert = registerPlugin<{ toMp4(o: { path: string }): Promise<{ path: string }> }>('VideoConvert');

/**
 * Filmul ca mp4: dacă WebView-ul a putut înregistra doar WebM, Android îl
 * convertește (plugins/VideoConvertPlugin.kt). Dacă nu se poate, trimitem WebM-ul.
 */
async function shareFilm(blob: Blob, ext: string, base: string, title: string): Promise<void> {
  if (ext === 'webm' && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('VideoConvert')) {
    try {
      const written = await Filesystem.writeFile({ path: `${base}.webm`, data: await blobToBase64(blob), directory: Directory.Cache });
      const { path } = await VideoConvert.toMp4({ path: written.uri });
      try {
        await Share.share({ files: [`file://${path}`], title, text: title });
      } catch (err) {
        if (!(err instanceof Error && /cancel/i.test(err.message))) throw err;
      }
      return;
    } catch {
      // conversia n-a mers: trimitem filmul așa cum e
    }
  }
  await shareCollage(blob, `${base}.${ext}`, title);
}
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
      const base = `lumin-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poveste'}`;
      setProgress(r.ext === 'webm' ? 1 : null);
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
