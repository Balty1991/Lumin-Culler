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
    return { series, rejected, count: ids.size, bytes };
  }, [photos]);

  return (
    <div className="lx-screen lx-clean">
      <header className="lx-head"><h1 className="lx-title">{tr('lx.clean.title')}</h1></header>
      <section className="lx-clean-hero">
        <span className="lx-eyebrow">{tr('lx.clean.heroEyebrow')}</span>
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
      </section>

      <WeeklyClean />
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
      <Housekeeping />
      <VideoCleanup />
      <FreedCard />
    </div>
  );
}
