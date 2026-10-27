import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { dayStats, startOfDay } from '../core/todayDigest';
import { countGalleryPhotosSince, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { t, plural } from '../i18n';

/**
 * ui/TodayCard.tsx
 * „Ziua de azi”, sus pe Acasă: câte poze ai făcut azi, câte a păstrat AI-ul
 * și ce mai așteaptă un „da/nu” de la tine. O atingere aduce pozele zilei din
 * galerie, le sortează și deschide verificarea. E și ținta notificării de
 * seară (core/todayDigest.ts).
 */
export function TodayCard() {
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const importing = useStore(s => s.supervisorImporting);
  const locale = useStore(s => s.locale);
  const importToday = useStore(s => s.importToday);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const stats = useMemo(() => dayStats(photos), [photos]);
  // Cu tot cu documente: galeria le numără și pe ele.
  const inLibraryToday = useMemo(() => {
    const from = startOfDay();
    return photos.filter(p => p.capturedAt !== undefined && p.capturedAt >= from).length;
  }, [photos]);
  const [inGallery, setInGallery] = useState<number | null>(null);
  const busy = importing || (!!progress && progress.phase !== 'finalizat');

  useEffect(() => {
    if (!isNativeMediaLibraryAvailable() || busy) return;
    let alive = true;
    void countGalleryPhotosSince(startOfDay()).then(r => { if (alive && r.granted) setInGallery(r.count); }).catch(() => {});
    return () => { alive = false; };
  }, [busy, photos.length]);

  const waiting = Math.max(0, (inGallery ?? 0) - inLibraryToday);
  if (waiting === 0 && stats.total === 0) return null;

  const sortDay = async () => {
    await importToday();
    const fresh = dayStats(useStore.getState().photos);
    if (fresh.reviewIds.length) openTiktokSortForIds(fresh.reviewIds);
  };

  let title: string;
  let sub: string;
  let cta: string;
  let action: () => void;
  if (waiting > 0) {
    title = tr(plural(waiting, 'today.waiting.title.one', 'today.waiting.title.other'), { count: waiting });
    sub = tr('today.waiting.sub');
    cta = tr('today.waiting.cta');
    action = () => void sortDay();
  } else if (stats.reviewIds.length > 0) {
    title = tr('today.done.title', { total: stats.total, kept: stats.kept });
    sub = tr(plural(stats.reviewIds.length, 'today.review.sub.one', 'today.review.sub.other'), { count: stats.reviewIds.length });
    cta = tr('today.review.cta');
    action = () => openTiktokSortForIds(stats.reviewIds);
  } else {
    title = tr('today.done.title', { total: stats.total, kept: stats.kept });
    sub = tr('today.clear.sub');
    cta = tr('today.clear.cta');
    action = () => openTiktokSortForIds(stats.keptIds);
  }

  return (
    <section className="today-card" aria-label={tr('today.label')}>
      <span className="today-card-kicker mono">{tr('today.label')}</span>
      <b className="today-card-title">{title}</b>
      <span className="today-card-sub">{sub}</span>
      <button className="btn-accent today-card-cta" onClick={action} disabled={busy}>{cta}</button>
    </section>
  );
}
