import { useEffect, useMemo, useState } from 'react';
import { useLxPhotos } from './useLxPhotos';
import { db } from '../core/db';
import { findExactDuplicates } from '../core/exactDuplicates';
import { formatBytes } from '../core/freedSpace';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { photoTime } from './days';
import { monthLabel } from './format';
import { monthStart } from './coverage';

/**
 * lumin/Housekeeping.tsx
 * Curățenia pe care o face Lumi pentru tine:
 * - lunară: ce a rămas la „Nu azi” în lunile trecute, cu spațiul pe care îl eliberezi;
 * - „gunoi sigur”: capturi de ecran mai vechi de 30 de zile și copii identice
 *   ale aceleiași poze (păstrăm una). Nimic din ce ai păstrat nu intră aici.
 * Totul trece prin confirmarea Android și ajunge în coșul galeriei.
 */
const DAY = 86_400_000;
const bytes = (list: readonly PhotoView[]) => list.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);

export function Housekeeping() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const deleteRejectedPhotos = useStore(s => s.deleteRejectedPhotos);
  const trashPhotos = useStore(s => s.trashPhotos);
  const [dupes, setDupes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Lunile trecute: cea mai recentă lună încheiată cu poze la „Nu azi”.
  const month = useMemo(() => {
    const now = monthStart(Date.now());
    const byMonth = new Map<number, PhotoView[]>();
    for (const p of photos) {
      if (p.status !== 'rejected' || !p.mediaUri) continue;
      const m = monthStart(photoTime(p));
      if (m >= now) continue;
      byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
    }
    const latest = [...byMonth.keys()].sort((a, b) => b - a)[0];
    return latest === undefined ? null : { start: latest, list: byMonth.get(latest)! };
  }, [photos]);

  const oldShots = useMemo(() => photos.filter(p => p.aside === 'screenshot' && p.status !== 'selected' && p.mediaUri && photoTime(p) < Date.now() - 30 * DAY), [photos]);

  useEffect(() => {
    let alive = true;
    void db.photos.toArray().then(rows => {
      const hash = new Map(rows.map(r => [r.id, r.dHash]));
      const sets = findExactDuplicates(photos.filter(p => p.mediaUri && hash.get(p.id)).map(p => ({
        id: p.id, dHash: hash.get(p.id)!, sizeBytes: p.sizeBytes, fileName: p.fileName,
        capturedAt: p.capturedAt, importedAt: p.importedAt, status: p.status
      })));
      const byId = new Map(photos.map(p => [p.id, p]));
      // Un grup care are o poză păstrată poate fi chiar albumul făcut de Lumi în
      // galerie (copii identice ale pozelor păstrate) — acela nu e gunoi.
      const safe = sets.filter(s => ![s.keepId, ...s.duplicateIds].some(id => byId.get(id)?.status === 'selected'));
      if (alive) setDupes(safe.flatMap(s => s.duplicateIds));
    }).catch(() => {});
    return () => { alive = false; };
  }, [photos]);

  if (!isNativeMediaLibraryAvailable()) return null;
  const junk = [...new Set([...oldShots.map(p => p.id), ...dupes])];
  const junkPhotos = photos.filter(p => junk.includes(p.id));
  if ((!month || month.list.length < 3) && !junk.length) return null;

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <section className="lx-section lx-housekeeping">
      <div className="lx-section-head"><h2>{tr('lx.clean.title')}</h2></div>
      {month && month.list.length >= 3 && (
        <div className="lx-card lx-clean-row">
          <div>
            <b>{tr('lx.clean.month', { month: monthLabel(month.start, locale), count: month.list.length })}</b>
            <span>{tr('lx.clean.frees', { size: formatBytes(bytes(month.list), locale) })}</span>
          </div>
          <button className="lx-btn primary small" disabled={busy} onClick={() => void run(() => deleteRejectedPhotos(month.list.map(p => p.id)))}>{tr('lx.clean.go')}</button>
        </div>
      )}
      {junk.length > 0 && (
        <div className="lx-card lx-clean-row">
          <div>
            <b>{tr('lx.clean.junk', { count: junk.length })}</b>
            <span>{[oldShots.length ? tr('lx.clean.shots', { count: oldShots.length }) : '', dupes.length ? tr('lx.clean.dupes', { count: dupes.length }) : ''].filter(Boolean).join(' · ')} · {formatBytes(bytes(junkPhotos), locale)}</span>
          </div>
          <button className="lx-btn ghost small" disabled={busy} onClick={() => { if (!useStore.getState().gatePremium('cleanup')) void run(() => trashPhotos(junk)); }}>{tr('lx.clean.go')}</button>
        </div>
      )}
      <p className="lx-hint">{tr('lx.clean.safe')}</p>
    </section>
  );
}
