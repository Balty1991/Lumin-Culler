import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { dayStats, startOfDay } from '../core/todayDigest';
import { countGalleryPhotosSince, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { getCachedThumbUrl, peekThumbUrl } from '../core/thumbUrlCache';
import { isReviewQueue } from '../core/singletonVerdict';
import { t } from '../i18n';

const DAY_MS = 86_400_000;

function Thumb({ id, lqip, score }: { id: string; lqip?: string; score: number }) {
  const [src, setSrc] = useState<string | null>(() => peekThumbUrl(id));
  useEffect(() => {
    let alive = true;
    if (!src) void getCachedThumbUrl(id).then(url => { if (alive && url) setSrc(url); });
    return () => { alive = false; };
  }, [id, src]);
  const shown = src ?? lqip;
  return (
    <span className="v3-today-thumb">
      {shown && <img src={shown} alt="" />}
      <b className="v3-mono">{score}</b>
    </span>
  );
}

/**
 * ui/TodayCard.tsx
 * „Ziua de azi”, capul ecranului Acasă (redesign v3): câte poze ai făcut azi
 * și câte merită păstrate, pozele alese de AI, din ce s-au ales (rafale,
 * respinse, documente) și un singur buton: ce mai așteaptă un „da/nu”. Sub
 * el, zilele trecute. O atingere aduce pozele zilei din galerie și le
 * sortează; e și ținta notificării de seară (core/todayDigest.ts).
 */
export function TodayCard() {
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const importing = useStore(s => s.supervisorImporting);
  const locale = useStore(s => s.locale);
  const importToday = useStore(s => s.importToday);
  const openTiktokSortForIds = useStore(s => s.openTiktokSortForIds);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const dateLocale = locale === 'en' ? 'en-GB' : 'ro-RO';

  const stats = useMemo(() => dayStats(photos), [photos]);
  const today = useMemo(() => {
    const from = startOfDay();
    const all = photos.filter(p => p.capturedAt !== undefined && p.capturedAt >= from);
    const kept = all.filter(p => p.status === 'selected' && !p.aside).sort((a, b) => b.aiScore - a.aiScore);
    return {
      all: all.length,
      kept,
      fromBursts: all.filter(p => p.groupId && !p.aside).length,
      rejected: all.filter(p => p.status === 'rejected').length,
      documents: all.filter(p => !!p.aside).length
    };
  }, [photos]);
  const history = useMemo(() => {
    const from = startOfDay();
    return [1, 2, 3].map(back => {
      const start = from - back * DAY_MS;
      const end = start + DAY_MS;
      const day = photos.filter(p => p.capturedAt !== undefined && p.capturedAt >= start && p.capturedAt < end && !p.aside);
      return {
        start,
        total: day.length,
        kept: day.filter(p => p.status === 'selected').length,
        waiting: day.filter(p => p.status === 'review' && isReviewQueue(p)).map(p => p.id)
      };
    }).filter(d => d.total > 0);
  }, [photos]);

  const [inGallery, setInGallery] = useState<number | null>(null);
  const busy = importing || (!!progress && progress.phase !== 'finalizat');
  useEffect(() => {
    if (!isNativeMediaLibraryAvailable() || busy) return;
    let alive = true;
    void countGalleryPhotosSince(startOfDay()).then(r => { if (alive && r.granted) setInGallery(r.count); }).catch(() => {});
    return () => { alive = false; };
  }, [busy, photos.length]);

  const waiting = Math.max(0, (inGallery ?? 0) - today.all);
  if (waiting === 0 && today.all === 0 && history.length === 0) return null;

  const sortDay = async () => {
    await importToday();
    const fresh = dayStats(useStore.getState().photos);
    if (fresh.reviewIds.length) openTiktokSortForIds(fresh.reviewIds);
  };
  const dateLabel = new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: '2-digit', month: '2-digit' });

  return (
    <div className="v3-today">
      <span className="v3-kicker">{dateLabel} · {tr('today.label')}</span>
      {waiting > 0 ? (
        <h2 className="v3-today-title">
          {tr('today.v3.waiting', { count: waiting })}<br /><em>{tr('today.v3.waitingSub')}</em>
        </h2>
      ) : today.all > 0 ? (
        <h2 className="v3-today-title">
          {tr('today.v3.total', { count: stats.total })}<br /><em>{tr('today.v3.kept', { count: stats.kept })}</em>
        </h2>
      ) : (
        <h2 className="v3-today-title">{tr('today.v3.none')}</h2>
      )}

      {(today.all > 0 || waiting > 0) && (
        <section className="v3-panel v3-today-panel">
          {today.kept.length > 0 && (
            <div className="v3-today-thumbs">
              {today.kept.slice(0, 4).map(p => <Thumb key={p.id} id={p.id} lqip={p.lqip} score={p.aiScore} />)}
            </div>
          )}
          {today.all > 0 && (
            <div className="v3-stats">
              <div><b>{today.fromBursts}</b><span>{tr('today.v3.bursts')}</span></div>
              <div><b>{today.rejected}</b><span>{tr('today.v3.rejected')}</span></div>
              <div><b>{today.documents}</b><span>{tr('today.v3.documents')}</span></div>
            </div>
          )}
          {waiting > 0 ? (
            <button className="v3-cta" onClick={() => void sortDay()} disabled={busy}>
              <span>{tr('today.waiting.cta')}</span><span className="v3-mono">{waiting} →</span>
            </button>
          ) : stats.reviewIds.length > 0 ? (
            <button className="v3-cta" onClick={() => openTiktokSortForIds(stats.reviewIds)}>
              <span>{tr('today.v3.check', { count: stats.reviewIds.length })}</span>
              <span className="v3-mono">~{Math.max(10, stats.reviewIds.length * 6)} s →</span>
            </button>
          ) : (
            <button className="v3-cta ghosted" onClick={() => openTiktokSortForIds(stats.keptIds)} disabled={!stats.keptIds.length}>
              <span>{tr('today.clear.cta')}</span><span className="v3-mono">✓</span>
            </button>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="v3-history">
          <span className="v3-kicker">{tr('today.v3.history')}</span>
          {history.map(d => (
            <button key={d.start} className="v3-history-row" disabled={!d.waiting.length}
              onClick={() => { if (d.waiting.length) openTiktokSortForIds(d.waiting); }}>
              <span>{new Date(d.start).toLocaleDateString(dateLocale, { weekday: 'long' })}</span>
              <span className="v3-mono" style={{ color: d.waiting.length ? 'var(--review)' : 'var(--pick)' }}>
                {d.total} → {d.kept} · {d.waiting.length ? tr('today.v3.pending', { count: d.waiting.length }) : tr('today.v3.done')}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
