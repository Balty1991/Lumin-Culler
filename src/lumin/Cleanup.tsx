import { useState } from 'react';
import { autopilotKeeps } from '../state/batchOps';
import { haptic } from '../core/device';
import { useStore, type PhotoView } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { plural } from '../i18n';
import { useTr } from './context';
import { formatBytes } from '../core/freedSpace';
import { claimPaywall, setPaywallContext } from './paywallMoment';

/**
 * lumin/Cleanup.tsx
 * Ce se întâmplă cu „Nu azi”, spus pe față. Raportat: „nu înțeleg cu cele
 * respinse, cum se șterg”. „Nu azi” doar le scoate din alegeri — rămân în
 * galeria telefonului până apeși aici. Atunci Android cere o confirmare și le
 * mută în coșul galeriei, de unde se pot recupera; abia apoi dispar și din Lumin.
 */
export function CleanupCard({ photos, compact = false }: { photos: readonly PhotoView[]; compact?: boolean }) {
  const tr = useTr();
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [freedLabel, setFreedLabel] = useState<string | null>(null);
  const locale = useStore(s => s.locale);
  // Doar ce pleacă de fapt: în bloc, pozele cu familia respinse de AI și documentele rămân
  // (autopilotKeeps), așa că nici nu le numărăm la spațiul eliberat.
  const rejected = photos.filter(p => p.status === 'rejected' && p.mediaUri && (autopilotKeeps(p) === null));
  const bytes = rejected.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);
  if (!isNativeMediaLibraryAvailable() || (rejected.length === 0 && done === null)) return null;

  const run = async () => {
    setBusy(true);
    try {
      haptic('long');
      const r = await deleteRejectedPhotos(rejected.map(p => p.id));
      if (!r.cancelled) {
        setDone(r.deleted);
        if (r.deleted > 0 && bytes > 0) setFreedLabel(formatBytes(bytes, locale));
        // Oferta vine după rezultat, nu în locul curățeniei. Cel mult una pe zi.
        if (r.deleted > 0 && useStore.getState().premiumLocked && claimPaywall()) {
          setPaywallContext(tr('lx.paywall.afterClean', { size: formatBytes(bytes, locale) }));
          useStore.setState({ premiumOpen: true, premiumReason: 'cleanup' });
        }
      }
    } finally { setBusy(false); }
  };

  if (done !== null) return (
    <section className="lx-freed-burst" role="status">
      {freedLabel && <b>{freedLabel}</b>}
      <span>{tr('ritual.trashed', { count: done })}</span>
    </section>
  );

  return (
    <section className={compact ? 'lx-card lx-cleanup compact' : 'lx-card lx-cleanup'}>
      <div>
        <b>{tr(plural(rejected.length, 'lx.cleanup.title.one', 'lx.cleanup.title'), { count: rejected.length })}</b>
        {bytes > 0 && <span className="lx-cleanup-size">{tr('lx.cleanup.frees', { size: formatBytes(bytes, locale) })}</span>}
        {!compact && <span>{tr('lx.cleanup.explain')}</span>}
      </div>
      <button className="lx-btn ghost danger-soft" disabled={busy} onClick={() => void run()}>
        {tr(plural(rejected.length, 'ritual.trash.one', 'ritual.trash'), { count: rejected.length })}
      </button>
    </section>
  );
}
