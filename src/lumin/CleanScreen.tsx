import { useMemo } from 'react';
import { useStore } from '../state/store';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useTr } from './context';
import { formatBytes } from '../core/freedSpace';
import { seriesExtras } from './LumiFeed';
import { CleanupCard } from './Cleanup';
import { Housekeeping } from './Housekeeping';
import { VideoCleanup } from './VideoCleanup';
import { FreedCard } from './TwinParts';
import { Icon } from './icons';
import { WeeklyClean } from './WeeklyClean';
import { FolderClean } from './FolderClean';
import { BurstTidy } from './BurstTidy';

/**
 * lumin/CleanScreen.tsx
 * Fila „Curățenie”: promisiunea din titlul aplicației are locul ei. Sus, cât se
 * poate elibera acum (poze în plus din serii + cele puse la „Nu azi”), apoi
 * uneltele care existau deja, adunate: serii, coș, capturi vechi, video.
 * Nimic nu se șterge de aici fără confirmarea omului; totul trece prin coșul galeriei.
 */
export function CleanScreen() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const openSort = useLx(s => s.openSort);
  const sum = useMemo(() => {
    const series = seriesExtras(photos);
    const rejected = photos.filter(p => !p.aside && p.status === 'rejected' && p.mediaUri);
    const ids = new Set([...series.extras, ...rejected].map(p => p.id));
    const bytes = photos.filter(p => ids.has(p.id)).reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
    // Serii cu mai multe poze încă păstrate: nu se șterg de aici, dar nici galeria nu e „curată”.
    const tidyGroups = new Map<string, number>();
    for (const p of photos) if (p.groupId && !p.aside && p.status !== 'rejected') tidyGroups.set(p.groupId, (tidyGroups.get(p.groupId) ?? 0) + 1);
    const tidy = [...tidyGroups.values()].some(n => n >= 2);
    return { series, rejected, count: ids.size, bytes, tidy };
  }, [photos]);

  return (
    <div className="lx-screen lx-clean">
      <header className="lx-head"><h1 className="lx-title">{tr('lx.clean.title')}</h1></header>
      {(sum.count > 0 || !sum.tidy) && <section className="lx-clean-hero">
        {sum.count > 0 && <span className="lx-eyebrow">{tr('lx.clean.heroEyebrow')}</span>}
        {sum.count > 0 ? (
          <>
            <b>{sum.bytes > 0 ? formatBytes(sum.bytes, locale) : tr('lx.clean.heroCount', { count: sum.count })}</b>
            <span>{tr('lx.clean.heroSub', { count: sum.count })}</span>
          </>
        ) : (
          <>
            <b>{tr('lx.clean.heroClean')}</b>
            <span>{tr('lx.clean.heroCleanSub')}</span>
          </>
        )}
      </section>}

      <WeeklyClean />
      <BurstTidy photos={photos.filter(p => !p.aside)} />
      {sum.series.extras.length > 0 && (
        <button className="lx-burst-tidy" onClick={() => openSort(sum.series.extras.map(p => p.id), tr('lx.story.series.badge'))}>
          <span className="lx-burst-tidy-icon"><Icon name="faces" size={18} /></span>
          <span className="lx-burst-tidy-text">
            <b>{tr('lx.story.series.title', { count: sum.series.extras.length })}</b>
            <small>{tr('lx.story.series.sub', { sets: sum.series.sets })}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}
      <CleanupCard photos={photos.filter(p => !p.aside)} />
      <FolderClean />
      <Housekeeping />
      <VideoCleanup />
      <FreedCard />
    </div>
  );
}
