import { useMemo, useRef, useState } from 'react';
import { haptic } from '../core/device';
import { createPortal } from 'react-dom';
import { useStore, type PhotoView } from '../state/store';
import { useLx } from './lxStore';
import { useTr } from './context';
import { Thumb } from './Thumb';
import { autoFolders } from './autoFolders';

/**
 * lumin/AsideView.tsx
 * „Puse deoparte” (bonuri, capturi, documente): le poți grupa în dosare și
 * șterge mai multe deodată. Cerut: „să le poți crea folder să le grupezi în el,
 * sau să ștergi, și să poți selecție multiplă să fie ușor de șters”.
 *
 * Dosarele sunt cele obișnuite ale aplicației (colecții); aici se arată doar
 * cele care au poze puse deoparte. Ștergerea trece prin confirmarea Android.
 */
const ALL = '';
const LOOSE = '-';

export function AsideView({ aside }: { aside: PhotoView[] }) {
  const tr = useTr();
  const collections = useStore(s => s.collections);
  const trashPhotos = useStore(s => s.trashPhotos);
  const deleteCollection = useStore(s => s.deleteCollection);
  const removePhotosFromCollection = useStore(s => s.removePhotosFromCollection);
  const openViewer = useLx(s => s.openViewer);
  const openSort = useLx(s => s.openSort);
  const [folder, setFolder] = useState(ALL);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const press = useRef<number | null>(null);
  const longPressed = useRef(false);

  const ids = useMemo(() => new Set(aside.map(p => p.id)), [aside]);
  const folders = useMemo(
    () => collections
      .filter(c => !c.isPrivate)
      .map(c => ({ id: c.id, name: c.name, members: new Set(c.memberIds.filter(id => ids.has(id))) }))
      .filter(c => c.members.size > 0),
    [collections, ids]
  );
  const inFolder = useMemo(() => new Set(folders.flatMap(f => [...f.members])), [folders]);
  const current = folders.find(f => f.id === folder);
  // Dosarele care se fac singure (bonuri pe ani, acte, capturi de chat) — vezi autoFolders.ts.
  const auto = useMemo(() => autoFolders(aside), [aside]);
  const currentAuto = auto.find(f => f.id === folder);
  const list = folder === ALL ? aside
    : folder === LOOSE ? aside.filter(p => !inFolder.has(p.id))
    : currentAuto ? aside.filter(p => currentAuto.ids.includes(p.id))
    : aside.filter(p => current?.members.has(p.id));

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const stop = () => { setSelecting(false); setPicked(new Set()); };
  const startPress = (id: string) => {
    longPressed.current = false;
    press.current = window.setTimeout(() => {
      longPressed.current = true;
      haptic('long');
      setSelecting(true);
      setPicked(prev => new Set(prev).add(id));
      navigator.vibrate?.(15);
    }, 420);
  };
  const endPress = () => { if (press.current) window.clearTimeout(press.current); press.current = null; };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await trashPhotos([...picked]);
      if (r.deleted) stop();
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="lx-chips lx-aside-folders">
        <button className={folder === ALL ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFolder(ALL)}>{tr('lx.aside.all')} <b>{aside.length}</b></button>
        {auto.map(f => (
          <button key={f.id} className={folder === f.id ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFolder(f.id)}>
            ✨ {tr(`lx.autoFolder.${f.key}`, { year: f.year ?? '' })} <b>{f.ids.length}</b>
          </button>
        ))}
        {folders.map(f => (
          <button key={f.id} className={folder === f.id ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFolder(f.id)}>📁 {f.name} <b>{f.members.size}</b></button>
        ))}
        {folders.length > 0 && aside.length > inFolder.size && (
          <button className={folder === LOOSE ? 'lx-chip-btn on' : 'lx-chip-btn'} onClick={() => setFolder(LOOSE)}>{tr('lx.aside.loose')} <b>{aside.length - inFolder.size}</b></button>
        )}
      </div>

      <div className="lx-aside-head">
        <p className="lx-hint">{tr(selecting ? 'lx.aside.selectHint' : 'lx.days.asideHint')}</p>
        {selecting
          ? <button className="lx-link" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map(p => p.id)))}>{tr(picked.size === list.length ? 'lx.aside.none' : 'lx.aside.selectAll')}</button>
          : <button className="lx-link" onClick={() => setSelecting(true)}>{tr('lx.aside.select')}</button>}
      </div>

      <div className="lx-grid">
        {list.map(p => (
          <button key={p.id} className={`lx-grid-cell${selecting ? ' choosing' : ''}${picked.has(p.id) ? ' chosen' : ''}`}
            onPointerDown={() => startPress(p.id)} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
            onContextMenu={e => e.preventDefault()}
            onClick={() => {
              if (longPressed.current) { longPressed.current = false; return; }
              if (selecting) toggle(p.id);
              else openViewer(list.map(x => x.id), list.indexOf(p));
            }}>
            <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
            {selecting && <span className="lx-face-check">{picked.has(p.id) ? '✓' : ''}</span>}
          </button>
        ))}
      </div>

      {current && !selecting && (
        <button className="lx-link center" onClick={() => { void deleteCollection(current.id); setFolder(ALL); }}>{tr('lx.aside.deleteFolder', { name: current.name })}</button>
      )}
      {!selecting && <button className="lx-btn ghost wide" onClick={() => openSort(list.map(p => p.id), tr('lx.day.aside'))}>{tr('lx.days.asideReview')}</button>}

      {selecting && (
        <div className="lx-pickbar lx-aside-bar" role="region" aria-live="polite">
          <button className="lx-icon-btn" onClick={stop} aria-label={tr('lx.close')}>✕</button>
          <span>{tr('lx.aside.picked', { count: picked.size })}</span>
          {current && (
            <button className="lx-btn ghost small" disabled={!picked.size || busy} onClick={() => { void removePhotosFromCollection(current.id, [...picked]); stop(); }}>{tr('lx.aside.outOfFolder')}</button>
          )}
          <button className="lx-btn ghost small" disabled={!picked.size || busy} onClick={() => setAsking(true)} aria-label={tr('lx.aside.folderTitle', { count: picked.size })}>📁</button>
          <button className="lx-btn danger small" disabled={!picked.size || busy} onClick={() => void remove()}>🗑 {tr('lx.aside.delete')}</button>
        </div>
      )}
      {asking && <FolderSheet ids={[...picked]} onClose={done => { setAsking(false); if (done) stop(); }} />}
    </>
  );
}

/** Alege un dosar sau fă unul nou, și mută pozele alese în el. */
function FolderSheet({ ids, onClose }: { ids: string[]; onClose: (done: boolean) => void }) {
  const tr = useTr();
  const collections = useStore(s => s.collections);
  const createCollection = useStore(s => s.createCollection);
  const addPhotosToCollection = useStore(s => s.addPhotosToCollection);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const put = async (target: { id: string } | null) => {
    setBusy(true);
    try {
      const into = target ?? await createCollection(name.trim());
      if (into) await addPhotosToCollection(into.id, ids);
      onClose(!!into);
    } finally { setBusy(false); }
  };
  const existing = collections.filter(c => !c.isPrivate);
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={() => onClose(false)}>
      <div className="lx-sheet" onClick={e => e.stopPropagation()}>
        <h2>{tr('lx.aside.folderTitle', { count: ids.length })}</h2>
        <form className="lx-sheet-new" onSubmit={e => { e.preventDefault(); if (name.trim()) void put(null); }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tr('lx.aside.folderName')} maxLength={40} autoFocus />
          <button className="lx-btn primary small" disabled={!name.trim() || busy}>{tr('lx.aside.create')}</button>
        </form>
        {existing.length > 0 && (
          <div className="lx-sheet-list">
            {existing.map(c => (
              <button key={c.id} className="lx-row button" disabled={busy} onClick={() => void put(c)}>
                <span>📁 {c.name}</span><b>{c.memberIds.length}</b>
              </button>
            ))}
          </div>
        )}
        <button className="lx-btn ghost wide" onClick={() => onClose(false)}>{tr('lx.enhance.cancel')}</button>
      </div>
    </div>,
    document.body
  );
}
