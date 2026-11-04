import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useTr } from './context';
import { Icon } from './icons';
import { Thumb } from './Thumb';

/**
 * „Seriile, dintr-o atingere”: în fiecare rafală/serie cu mai multe poze
 * încă păstrate, rămâne una singură (cea aleasă de om, altfel cea mai bună
 * după AI); celelalte trec la „Nu azi” — nimic nu se șterge.
 * Înainte de a face ceva, omul vede fiecare serie și poate schimba alegerea
 * (raportat: „ar trebui să văd care sunt”).
 */
export function BurstTidy({ photos }: { photos: readonly PhotoView[] }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, PhotoView[]>();
    for (const p of photos) if (p.groupId && p.status !== 'rejected') m.set(p.groupId, [...(m.get(p.groupId) ?? []), p]);
    return [...m.entries()].filter(([, v]) => v.length >= 2);
  }, [photos]);
  const extra = groups.reduce((a, [, v]) => a + v.length - 1, 0);
  if (groups.length === 0) return null;
  return (
    <>
      <button className="lx-burst-tidy" onClick={() => setOpen(true)}>
        <span className="lx-burst-tidy-icon"><Icon name="similar" size={18} /></span>
        <span className="lx-burst-tidy-text">
          <b>{tr('lx.burstTidy.title', { count: extra })}</b>
          <small>{tr('lx.burstTidy.sub', { groups: groups.length })}</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {open && <BurstTidySheet groups={groups} onClose={() => setOpen(false)} />}
    </>
  );
}

function BurstTidySheet({ groups, onClose }: { groups: Array<[string, PhotoView[]]>; onClose: () => void }) {
  const tr = useTr();
  const setNotice = useStore(s => s.setNotice);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Propunerea: cea aleasă de om (dacă e una singură păstrată), altfel cea mai bună după AI.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const st = useStore.getState();
      const out: Record<string, string> = {};
      for (const [gid, members] of groups) {
        const kept = members.filter(m => m.status === 'selected');
        out[gid] = kept.length === 1 ? kept[0].id : (await st.selectBestPhotoInGroup(gid).catch(() => null)) ?? members[0].id;
      }
      if (alive) setKeep(out);
    })();
    return () => { alive = false; };
  }, [groups]);

  const active = groups.filter(([gid]) => !skip.has(gid));
  const moving = active.reduce((a, [, v]) => a + v.length - 1, 0);
  const apply = async () => {
    setBusy(true);
    try {
      const st = useStore.getState();
      for (const [gid] of active) if (keep[gid]) await st.keepOnlyInGroup(gid, keep[gid]);
      setNotice(tr('lx.burstTidy.done', { count: moving }));
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="lx lx-enhance lx-tidy" role="dialog" aria-modal="true" aria-label={tr('lx.burstTidy.go')}>
      <header className="lx-viewer-top">
        <button className="lx-icon-btn" onClick={onClose} aria-label={tr('lx.close')}>✕</button>
        <span className="lx-viewer-date">{tr('lx.burstTidy.reviewTitle', { groups: groups.length })}</span>
        <span />
      </header>
      <p className="lx-hint center lx-tidy-hint">{tr('lx.burstTidy.reviewHint')}</p>
      <div className="lx-tidy-list">
        {groups.map(([gid, members]) => {
          const off = skip.has(gid);
          return (
            <section key={gid} className={off ? 'lx-tidy-group off' : 'lx-tidy-group'}>
              <div className="lx-tidy-row">
                {members.map(m => {
                  const isKeep = keep[gid] === m.id;
                  return (
                    <button key={m.id} className={isKeep ? 'lx-tidy-photo keep' : 'lx-tidy-photo'} disabled={off}
                      onClick={() => setKeep(k => ({ ...k, [gid]: m.id }))} aria-pressed={isKeep}>
                      <Thumb id={m.id} lqip={m.lqip} edits={m.edits} />
                      {isKeep && <span className="lx-tidy-badge"><Icon name="check" size={14} /></span>}
                    </button>
                  );
                })}
              </div>
              <button className="lx-link lx-tidy-skip" onClick={() => setSkip(s => { const n = new Set(s); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; })}>
                {off ? tr('lx.burstTidy.include') : tr('lx.burstTidy.leave')}
              </button>
            </section>
          );
        })}
      </div>
      <div className="lx-viewer-info">
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={onClose}>{tr('confirmDialog.cancel')}</button>
          <button className="lx-btn primary" disabled={busy || moving === 0 || Object.keys(keep).length === 0} onClick={() => void apply()}>
            {tr('lx.burstTidy.goCount', { count: moving })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
