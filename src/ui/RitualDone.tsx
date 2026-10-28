import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { recordRitualDay, readRitualDays, streakOf } from '../core/ritualStreak';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { t, plural } from '../i18n';

/**
 * ui/RitualDone.tsx
 * Finalul alegerii: ce ai păstrat, ce a rămas „nu azi”, câte zile la rând ai
 * terminat, și o singură cerere de coș pentru tot lotul. Swipe-ul doar
 * marchează; nimic nu pleacă din galerie până nu apeși aici, iar pozele
 * ajung în coșul galeriei, de unde se pot recupera.
 */
export function RitualDone({ ids, decided }: { ids: readonly string[]; decided: number }) {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [streak, setStreak] = useState(() => streakOf(readRitualDays()));
  const [trashing, setTrashing] = useState(false);
  const [trashed, setTrashed] = useState<number | null>(null);

  useEffect(() => {
    if (decided > 0) setStreak(recordRitualDay());
  }, [decided]);

  const session = useMemo(() => {
    const set = new Set(ids);
    const mine = photos.filter(p => set.has(p.id));
    return {
      kept: mine.filter(p => p.status === 'selected').length,
      notToday: mine.filter(p => p.status === 'rejected').length
    };
  }, [ids, photos]);
  const rejectedOnPhone = useMemo(() => photos.filter(p => p.status === 'rejected' && p.mediaUri).length, [photos]);

  const trash = async () => {
    setTrashing(true);
    try {
      const r = await deleteRejectedPhotos();
      if (!r.cancelled) setTrashed(r.deleted);
    } finally {
      setTrashing(false);
    }
  };

  return (
    <div className="rd">
      <span className="v3-kicker">{tr('ritual.kicker')}</span>
      <h3 className="rd-title">{tr('ritual.title')}</h3>
      {decided > 0 && (
        <div className="v3-stats rd-stats">
          <div><b style={{ color: 'var(--pick)' }}>{session.kept}</b><span>{tr('ritual.kept')}</span></div>
          <div><b>{session.notToday}</b><span>{tr('ritual.notToday')}</span></div>
          <div><b style={{ color: 'var(--review)' }}>{streak}</b><span>{tr(plural(streak, 'ritual.streak.one', 'ritual.streak'))}</span></div>
        </div>
      )}
      {streak > 1 && <p className="rd-note">{tr('ritual.streakNote')}</p>}
      {isNativeMediaLibraryAvailable() && rejectedOnPhone > 0 && trashed === null && (
        <button className="v3-cta" onClick={() => void trash()} disabled={trashing}>
          <span>{tr(plural(rejectedOnPhone, 'ritual.trash.one', 'ritual.trash'), { count: rejectedOnPhone })}</span>
          <span className="v3-mono">→</span>
        </button>
      )}
      {trashed !== null && <p className="rd-note">{tr('ritual.trashed', { count: trashed })}</p>}
      {isNativeMediaLibraryAvailable() && rejectedOnPhone > 0 && trashed === null && <p className="rd-note">{tr('ritual.trashHint')}</p>}
    </div>
  );
}
