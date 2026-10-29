import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes, recordFreed } from '../core/freedSpace';
import { deleteNativePhotos, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { findVideoCleanup, listGalleryVideos, saveBestVideoFrame, videoBytes, videoThumbUrl, type GalleryVideo } from '../core/nativeVideos';
import { useStore } from '../state/store';
import { setLastTrash } from '../state/lastTrash';
import { useTr } from './context';

/**
 * lumin/VideoCleanup.tsx
 * „Clipuri video”: de obicei ocupă cel mai mult loc din telefon, iar aplicația
 * nu le vedea deloc. Cherrypic le listează (fără să le citească) și găsește:
 * copiile aceluiași clip, clipurile de o clipă pornite din greșeală și cele mai
 * mari. Totul trece prin coșul Android, se poate recupera.
 *
 * Permisiunea pentru clipuri se cere doar când omul apasă „Caută”; după aceea
 * căutarea se reface singură la deschidere.
 */
const ASKED_KEY = 'lumin-videos-granted';
type Group = 'duplicates' | 'accidental' | 'big';
const GROUPS: Group[] = ['duplicates', 'accidental', 'big'];

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function VideoCleanup() {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const [videos, setVideos] = useState<GalleryVideo[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Group | null>(null);
  const [framing, setFraming] = useState(false);

  const scan = async () => {
    setBusy(true);
    try {
      const r = await listGalleryVideos();
      if (!r.granted) { setDenied(true); return; }
      try { localStorage.setItem(ASKED_KEY, '1'); } catch { /* fără stocare */ }
      setVideos(r.videos);
    } catch { setDenied(true); } finally { setBusy(false); }
  };
  useEffect(() => {
    let granted = false;
    try { granted = localStorage.getItem(ASKED_KEY) === '1'; } catch { /* fără stocare */ }
    if (granted) void scan();
  }, []);

  const found = useMemo(() => (videos ? findVideoCleanup(videos) : null), [videos]);
  if (!isNativeMediaLibraryAvailable()) return null;

  const removed = (uris: string[]) => setVideos(v => (v ? v.filter(x => !uris.includes(x.uri)) : v));

  return (
    <section className="lx-section lx-housekeeping">
      <div className="lx-section-head"><h2>🎬 {tr('lx.videos.title')}</h2></div>
      {!videos ? (
        <div className="lx-card lx-clean-row">
          <div>
            <b>{tr('lx.videos.intro')}</b>
            <span>{tr(denied ? 'lx.videos.denied' : 'lx.videos.introSub')}</span>
          </div>
          <button className="lx-btn primary small" disabled={busy} onClick={() => void scan()}>{busy ? '…' : tr('lx.videos.scan')}</button>
        </div>
      ) : (
        <>
          <p className="lx-hint">{tr('lx.videos.total', { count: videos.length, size: formatBytes(videoBytes(videos), locale) })}</p>
          {found && GROUPS.map(g => found[g].length > 0 && (
            <div key={g} className="lx-card lx-clean-row">
              <div>
                <b>{tr(`lx.videos.${g}`, { count: found[g].length })}</b>
                <span>{formatBytes(videoBytes(found[g]), locale)} · {tr(`lx.videos.${g}Sub`)}</span>
              </div>
              <button className={g === 'big' ? 'lx-btn ghost small' : 'lx-btn primary small'} onClick={() => setOpen(g)}>{tr('lx.videos.see')}</button>
            </div>
          ))}
          {found && GROUPS.every(g => !found[g].length) && <p className="lx-hint">{tr('lx.videos.clean')}</p>}
          {videos.length > 0 && (
            <div className="lx-card lx-clean-row">
              <div>
                <b>📸 {tr('lx.videos.frame')}</b>
                <span>{tr('lx.videos.frameSub')}</span>
              </div>
              <button className="lx-btn ghost small" onClick={() => setFraming(true)}>{tr('lx.videos.frameGo')}</button>
            </div>
          )}
        </>
      )}
      {open && found && (
        <VideoSheet title={tr(`lx.videos.${open}`, { count: found[open].length })} list={found[open]} preselect={open !== 'big'}
          onClose={() => setOpen(null)} onRemoved={removed} />
      )}
      {framing && videos && <FrameSheet list={videos.slice(0, 60)} onClose={() => setFraming(false)} />}
    </section>
  );
}

/** Alege un clip; Cherrypic îi caută cel mai clar cadru și îl salvează ca poză. */
function FrameSheet({ list, onClose }: { list: GalleryVideo[]; onClose: () => void }) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const setNotice = useStore(s => s.setNotice);
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (v: GalleryVideo) => {
    setBusy(v.uri);
    try {
      await saveBestVideoFrame(v.uri);
      setNotice(tr('lx.videos.frameSaved'));
      onClose();
    } catch {
      setNotice(tr('lx.videos.frameFailed'));
    } finally { setBusy(null); }
  };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet lx-video-sheet" onClick={e => e.stopPropagation()}>
        <h2>📸 {tr('lx.videos.frame')}</h2>
        <p className="lx-hint">{tr('lx.videos.framePick')}</p>
        <div className="lx-video-grid">
          {list.map(v => (
            <button key={v.uri} className="lx-video-cell" disabled={!!busy} onClick={() => void pick(v)}>
              <VideoThumb uri={v.uri} />
              <span className="lx-video-meta">{busy === v.uri ? '…' : `${duration(v.durationMs)} · ${formatBytes(v.sizeBytes, locale)}`}</span>
            </button>
          ))}
        </div>
        <button className="lx-btn ghost wide" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
      </div>
    </div>,
    document.body
  );
}

function VideoSheet({ title, list, preselect, onClose, onRemoved }: {
  title: string; list: GalleryVideo[]; preselect: boolean; onClose: () => void; onRemoved: (uris: string[]) => void;
}) {
  const tr = useTr();
  const locale = useStore(s => s.locale);
  const setNotice = useStore(s => s.setNotice);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect ? list.map(v => v.uri) : []));
  const [busy, setBusy] = useState(false);
  const chosen = list.filter(v => picked.has(v.uri));
  const toggle = (uri: string) => setPicked(p => { const n = new Set(p); if (n.has(uri)) n.delete(uri); else n.add(uri); return n; });

  const remove = async () => {
    setBusy(true);
    try {
      const r = await deleteNativePhotos(chosen.map(v => v.uri));
      if (r.cancelled) return;
      const gone = chosen.filter(v => !r.skippedUris.includes(v.uri));
      onRemoved(gone.map(v => v.uri));
      recordFreed(videoBytes(gone));
      setLastTrash(gone.map(v => v.uri));
      setNotice(tr('lx.videos.done', { count: gone.length, size: formatBytes(videoBytes(gone), locale) }));
      onClose();
    } catch {
      setNotice(tr('lx.videos.failed'));
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lx-sheet lx-video-sheet" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="lx-video-grid">
          {list.map(v => (
            <button key={v.uri} className={picked.has(v.uri) ? 'lx-video-cell chosen' : 'lx-video-cell'} onClick={() => toggle(v.uri)}>
              <VideoThumb uri={v.uri} />
              <span className="lx-video-meta">{duration(v.durationMs)} · {formatBytes(v.sizeBytes, locale)}</span>
              <span className="lx-face-check">{picked.has(v.uri) ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        <p className="lx-hint">{tr('lx.clean.safe')}</p>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr('lx.enhance.cancel')}</button>
          <button className="lx-btn danger" disabled={!chosen.length || busy} onClick={() => void remove()}>
            🗑 {tr('lx.videos.delete', { count: chosen.length, size: formatBytes(videoBytes(chosen), locale) })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function VideoThumb({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void videoThumbUrl(uri).then(u => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [uri]);
  return src ? <img src={src} alt="" loading="lazy" /> : <span className="lx-thumb-empty" />;
}
