import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { haptic } from '../core/device';
import { archiveCandidates, archiveNow, autoArchiveOn, setAutoArchive, useArchive } from './archive';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { useLxPhotos } from './useLxPhotos';

/**
 * lumin/ArchiveView.tsx
 * „Arhivă” (în Galerie → Deoparte): pozele vechi și slabe, scoase din drum,
 * dar nu șterse. Atingi una și o vezi mare; „Scoate din arhivă” le întoarce.
 */
export function ArchiveEntry() {
  const tr = useTr();
  const all = useStore(s => s.photos);
  const ids = useArchive(s => s.ids);
  const visible = useLxPhotos();
  const [open, setOpen] = useState(false);
  const archived = useMemo(() => all.filter(p => ids.has(p.id)), [all, ids]);
  const candidates = useMemo(() => archiveCandidates(visible), [visible]);
  if (open) return <ArchiveList onBack={() => setOpen(false)} />;
  if (!archived.length && !candidates.length) return null;
  return (
    <button className="lx-card lx-archive-card" onClick={() => archived.length ? setOpen(true) : undefined}>
      <span className="lx-archive-icon" aria-hidden="true">🗄</span>
      <div>
        <b>{tr('lx.archive.title')}{archived.length ? ` · ${archived.length}` : ''}</b>
        <span>{archived.length ? tr('lx.archive.sub') : tr('lx.archive.suggest', { count: candidates.length })}</span>
      </div>
      {!archived.length && candidates.length > 0 && (
        <span className="lx-btn primary small" role="button" onClick={e => { e.stopPropagation(); haptic('confirm'); archiveNow(visible); }}>{tr('lx.archive.now')}</span>
      )}
      {archived.length > 0 && <span className="lx-chev" aria-hidden="true">›</span>}
    </button>
  );
}

function ArchiveList({ onBack }: { onBack: () => void }) {
  const tr = useTr();
  const all = useStore(s => s.photos);
  const ids = useArchive(s => s.ids);
  const remove = useArchive(s => s.remove);
  const openViewer = useLx(s => s.openViewer);
  const list = useMemo(() => all.filter(p => ids.has(p.id)).sort((a, b) => (b.capturedAt ?? b.importedAt) - (a.capturedAt ?? a.importedAt)), [all, ids]);
  return (
    <>
      <div className="lx-head">
        <button className="lx-icon-btn" onClick={onBack} aria-label={tr('lx.back')}>‹</button>
        <h2 className="lx-title small">{tr('lx.archive.title')} · {list.length}</h2>
        <span />
      </div>
      <p className="lx-hint">{tr('lx.archive.explain')}</p>
      <div className="lx-grid">
        {list.map((p, i) => (
          <button key={p.id} className="lx-grid-cell" onClick={() => openViewer(list.map(x => x.id), i)}>
            <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
          </button>
        ))}
      </div>
      {list.length > 0 && (
        <button className="lx-btn ghost wide" onClick={() => { remove(list.map(p => p.id)); onBack(); }}>{tr('lx.archive.restoreAll')}</button>
      )}
    </>
  );
}

/** Setări: „Arhivă automată”, o dată pe săptămână. */
export function AutoArchiveRow() {
  const tr = useTr();
  const visible = useLxPhotos();
  const setNotice = useStore(s => s.setNotice);
  const [on, setOn] = useState(autoArchiveOn);
  const toggle = () => {
    setAutoArchive(!on);
    setOn(!on);
    if (!on) {
      const n = archiveNow(visible);
      setNotice(tr('lx.archive.done', { count: n }));
    }
  };
  return (
    <button className="lx-row button" role="switch" aria-checked={on} onClick={toggle}>
      <span><b>{tr('lx.archive.auto')}</b><small>{tr('lx.archive.autoSub')}</small></span>
      <span className={on ? 'lx-pill ok' : 'lx-pill'}>{on ? '✓' : tr('lx.autoBackup.off')}</span>
    </button>
  );
}
