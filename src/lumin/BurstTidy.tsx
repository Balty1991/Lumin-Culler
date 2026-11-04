import { useMemo, useState } from 'react';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';

/**
 * „Seriile, dintr-o atingere”: în fiecare rafală/serie cu mai multe poze
 * încă păstrate, rămâne una singură (cea aleasă de om, altfel cea mai bună
 * după AI); celelalte trec la „Nu azi” — nimic nu se șterge.
 */
export function BurstTidy({ photos }: { photos: readonly PhotoView[] }) {
  const tr = useTr();
  const askConfirm = useStore(s => s.askConfirm);
  const setNotice = useStore(s => s.setNotice);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, PhotoView[]>();
    for (const p of photos) if (p.groupId && p.status !== 'rejected') m.set(p.groupId, [...(m.get(p.groupId) ?? []), p]);
    return [...m.entries()].filter(([, v]) => v.length >= 2);
  }, [photos]);
  const extra = groups.reduce((a, [, v]) => a + v.length - 1, 0);
  if (groups.length === 0) return null;
  const run = async () => {
    if (!(await askConfirm(tr('lx.burstTidy.confirm', { groups: groups.length, count: extra }), { confirmLabel: tr('lx.burstTidy.go') }))) return;
    setBusy(true);
    try {
      const st = useStore.getState();
      for (const [gid, members] of groups) {
        const kept = members.filter(m => m.status === 'selected');
        const keep = kept.length === 1 ? kept[0].id : await st.selectBestPhotoInGroup(gid);
        if (keep) await st.keepOnlyInGroup(gid, keep);
      }
      setNotice(tr('lx.burstTidy.done', { count: extra }));
    } finally { setBusy(false); }
  };
  return (
    <button className="lx-burst-tidy" disabled={busy} onClick={() => void run()}>
      <span className="lx-burst-tidy-icon"><Icon name="similar" size={18} /></span>
      <span className="lx-burst-tidy-text">
        <b>{tr('lx.burstTidy.title', { count: extra })}</b>
        <small>{tr('lx.burstTidy.sub', { groups: groups.length })}</small>
      </span>
      <span aria-hidden="true">{busy ? '…' : '›'}</span>
    </button>
  );
}
