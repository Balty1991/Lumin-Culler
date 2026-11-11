import { useMemo, useState } from 'react';
import { settleFreeCleanup, useStore } from '../state/store';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useTr } from './context';
import { formatBytes } from '../core/freedSpace';
import { buildWeeklyReport, markWeeklyDone, weeklyDone } from './weeklyReport';
import { Thumb } from './Thumb';

/**
 * lumin/WeeklyClean.tsx
 * „Curățenia săptămânii” pe ecran: ce a pregătit Pilotul din ultimele șapte zile,
 * câteva miniaturi, cât eliberează și un singur buton. Omul poate vedea tot
 * înainte; ștergerea trece prin confirmarea Android și prin coșul galeriei.
 * Pro: în fiecare săptămână. Gratuit: intră la curățenia gratuită a lunii.
 */
export function WeeklyClean() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const premiumLocked = useStore(s => s.premiumLocked);
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<{ count: number; bytes: number } | null>(null);
  const report = useMemo(() => buildWeeklyReport(photos), [photos]);

  if (freed) return (
    <section className="lx-card lx-weekly" role="status">
      <span className="lx-eyebrow">{tr('lx.weekly.eyebrow')}</span>
      <b>{tr('lx.weekly.done', { count: freed.count })}</b>
      {freed.bytes > 0 && <span>{tr('lx.feed.frees', { size: formatBytes(freed.bytes, locale) })}</span>}
    </section>
  );
  if (report.photos.length < 3 || weeklyDone(report.week)) return null;

  const ids = report.photos.map(p => p.id);
  const run = async () => {
    const st = useStore.getState();
    if (st.gatePremium('cleanup')) return;
    setBusy(true);
    try {
      const r = await st.trashPhotos(ids);
      settleFreeCleanup(!r.cancelled && r.deleted > 0);
      if (!r.cancelled && r.deleted > 0) { markWeeklyDone(report.week); setFreed({ count: r.deleted, bytes: report.bytes }); }
    } finally { setBusy(false); }
  };

  return (
    <section className="lx-card lx-weekly">
      <span className="lx-eyebrow">{tr('lx.weekly.eyebrow')}{premiumLocked && <b className="lx-pro">PRO</b>}</span>
      <b>{tr('lx.weekly.title', { count: report.photos.length })}</b>
      <span>{[
        report.extras > 0 ? tr('lx.weekly.extras', { count: report.extras }) : '',
        report.rejected > 0 ? tr('lx.weekly.rejected', { count: report.rejected }) : '',
        report.bytes > 0 ? tr('lx.feed.frees', { size: formatBytes(report.bytes, locale) }) : ''
      ].filter(Boolean).join(' · ')}</span>
      <div className="lx-weekly-strip">
        {report.photos.slice(0, 6).map(p => <span key={p.id}><Thumb id={p.id} lqip={p.lqip} edits={p.edits} /></span>)}
      </div>
      <div className="lx-decide-actions">
        <button className="lx-btn primary" disabled={busy} onClick={() => void run()}>{tr('lx.weekly.go')}</button>
        <button className="lx-btn ghost" onClick={() => useLx.getState().openViewer(ids, 0)}>{tr('lx.feed.see')}</button>
      </div>
      <small className="lx-weekly-note">{tr(premiumLocked ? 'lx.weekly.noteFree' : 'lx.weekly.note')}</small>
    </section>
  );
}
