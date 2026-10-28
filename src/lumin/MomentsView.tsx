import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { buildMomentAlbums, type MomentAlbum } from './momentAlbums';
import { capitalizeFirst } from './format';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { StoryButton } from './Story';
import { canMakePhoneAlbums, copyToPhoneAlbum } from './phoneAlbums';
import type { PhotoView } from '../state/store';

/**
 * lumin/MomentsView.tsx
 * Galerie → Momente: albumele care s-au făcut singure. Fiecare e o copertă
 * mare (cea mai bună poză păstrată), cu numele momentului; o atingere îl
 * deschide, de unde se sortează sau se trimit alegerile.
 */
export function MomentsView() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const tr = useTr();
  const [open, setOpen] = useState<string | null>(null);
  const albums = useMemo(() => buildMomentAlbums(photos, locale === 'en' ? 'en' : 'ro'), [photos, locale]);
  const album = open ? albums.find(a => a.id === open) : undefined;

  if (album) return <AlbumView album={album} onBack={() => setOpen(null)} />;
  if (!albums.length) return <p className="lx-empty">{tr('lx.moments.empty')}</p>;

  return (
    <div className="lx-albums">
      {albums.map((a, i) => (
        <button key={a.id} className="lx-album" style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }} onClick={() => setOpen(a.id)}>
          <Thumb id={a.cover.id} lqip={a.cover.lqip} edits={a.cover.edits} className="lx-album-cover" />
          <span className="lx-album-shade" />
          <span className="lx-album-text">
            <b>{albumTitle(a, locale, tr)}</b>
            <span>{tr('lx.moments.meta', { count: a.photos.length, kept: a.photos.filter(p => p.status === 'selected').length })}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function albumTitle(a: MomentAlbum, locale: string, tr: (k: string, p?: Record<string, string | number>) => string): string {
  const day = capitalizeFirst(new Date(a.start).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', { weekday: 'long', day: 'numeric', month: 'short' }));
  const part = tr(`lx.moments.part.${a.part}`);
  return a.subject ? `${a.subject} · ${day}, ${part}` : `${day}, ${part}`;
}

function AlbumView({ album, onBack }: { album: MomentAlbum<PhotoView>; onBack: () => void }) {
  const locale = useStore(s => s.locale);
  const exportSelection = useStore(s => s.exportSelection);
  const openSort = useLx(s => s.openSort);
  const tr = useTr();
  const title = albumTitle(album, locale, tr);
  const kept = album.photos.filter(p => p.status === 'selected');
  const waiting = album.photos.filter(p => p.status === 'review' || p.status === 'pending' || p.status === 'candidate');
  return (
    <div className="lx-album-view">
      <div className="lx-album-hero">
        <Thumb id={album.cover.id} lqip={album.cover.lqip} edits={album.cover.edits} full className="lx-album-hero-img" />
        <span className="lx-album-shade" />
        <button className="lx-icon-btn lx-album-back" onClick={onBack} aria-label={tr('lx.back')}>‹</button>
        <div className="lx-album-hero-text">
          <h2>{title}</h2>
          <span>{tr('lx.moments.meta', { count: album.photos.length, kept: kept.length })}</span>
        </div>
      </div>
      <div className="lx-decide-actions">
        {waiting.length > 0 && <button className="lx-btn primary" onClick={() => openSort(waiting.map(p => p.id), title)}>{tr('lx.today.check')} · {waiting.length}</button>}
        {kept.length > 0 && <button className="lx-btn ghost" onClick={() => void exportSelection('apps', kept.map(p => p.id))}>{tr('lx.day.share', { count: kept.length })}</button>}
        {kept.length > 0 && canMakePhoneAlbums() && <button className="lx-btn ghost" onClick={() => void copyToPhoneAlbum(title, kept)}>{tr('lx.phone.toAlbum')}</button>}
        <StoryButton className="lx-btn ghost" ids={(kept.length >= 3 ? kept : album.photos).map(p => p.id)} title={title} subtitle={tr('lx.moments.meta', { count: album.photos.length, kept: kept.length })} />
      </div>
      <div className="lx-wall">
        {album.photos.map((p, i) => (
          <button key={p.id} className={`lx-tile ${p.status}`} style={{ animationDelay: `${i * 30}ms` }} onClick={() => useLx.getState().openViewer(album.photos.map(x => x.id), i)}>
            <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
            {p.status === 'selected' && <span className="lx-tile-star">★</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
