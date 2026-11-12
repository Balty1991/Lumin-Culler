import { useEffect, useMemo, useState } from 'react';
import { settleFreeCleanup, useStore } from '../state/store';
import { isNativeMediaLibraryAvailable, listPhotosInFolder, readGalleryFolders } from '../core/nativeMediaLibrary';
import { formatBytes } from '../core/freedSpace';
import { useLxPhotos } from './useLxPhotos';
import { useLx } from './lxStore';
import { useTr } from './context';
import { summarizeFolders, type FolderInfo, type FolderSummary } from './folderClean';

/**
 * lumin/FolderClean.tsx
 * „Curățenie pe dosare” în fila Curățenie: WhatsApp, descărcări, capturi și restul
 * dosarelor din galerie, cu cât se poate elibera din fiecare. „Vezi și alege” deschide
 * sortarea pe pozele dosarului; „Curăță dosarul” (Pro; gratuit intră la curățenia
 * lunii) le trimite pe toate în coșul galeriei, cu confirmarea Android.
 */
export function FolderClean() {
  const tr = useTr();
  const photos = useLxPhotos();
  const locale = useStore(s => s.locale);
  const premiumLocked = useStore(s => s.premiumLocked);
  const importing = useStore(s => s.supervisorImporting);
  const [folders, setFolders] = useState<FolderInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativeMediaLibraryAvailable()) return;
    let alive = true;
    void (async () => {
      const list = await readGalleryFolders();
      if (!list.granted) return;
      // Cele mai mari 12 dosare: listele lor (doar adrese, fără fișiere) se citesc pe rând.
      const top = [...list.folders].sort((a, b) => b.count - a.count).slice(0, 12);
      const out: FolderInfo[] = [];
      for (const f of top) {
        const r = await listPhotosInFolder(f.id).catch(() => null);
        out.push({ ...f, uris: r?.granted ? r.photos.map(p => p.uri) : [] });
      }
      if (alive) setFolders(out);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [importing]);

  const rows = useMemo(() => (folders ? summarizeFolders(folders, photos) : []), [folders, photos]);
  if (!rows.length) return null;

  const clean = async (f: FolderSummary) => {
    const st = useStore.getState();
    // Întâi oferta (dacă s-a folosit curățenia gratuită), apoi confirmarea: altfel omul
    // confirma ștergerea și abia apoi afla că nu se poate (auditul pe persoane).
    if (st.gatePremium('cleanup')) return;
    const ok = await st.askConfirm(tr('lx.folders.confirm', { count: f.removable.length, name: f.name }), { confirmLabel: tr('lx.folders.clean') });
    if (!ok) { settleFreeCleanup(false); return; }
    setBusy(f.id);
    try {
      const r = await st.trashPhotos(f.removable.map(p => p.id));
      settleFreeCleanup(!r.cancelled && r.deleted > 0);
    } finally { setBusy(null); }
  };

  return (
    <section className="lx-section">
      <div className="lx-section-head"><h2>{tr('lx.folders.title')}</h2></div>
      <div className="lx-folder-list">
        {rows.map(f => {
          const unread = Math.max(0, f.inGallery - f.read);
          return (
            <div key={f.id} className="lx-card lx-folder-row">
              <div className="lx-folder-text">
                <b>{f.name}</b>
                <span>{tr('lx.folders.count', { count: f.inGallery })}{f.removable.length > 0 ? ` · ${tr('lx.folders.removable', { count: f.removable.length })}` : ''}{f.bytes > 0 ? ` · ${formatBytes(f.bytes, locale)}` : ''}</span>
              </div>
              <div className="lx-folder-actions">
                {f.removable.length > 0 && (
                  <>
                    <button className="lx-btn ghost small" onClick={() => useLx.getState().openSort(f.removable.map(p => p.id), f.name)}>{tr('lx.folders.review')}</button>
                    <button className="lx-btn primary small" disabled={busy !== null} onClick={() => void clean(f)}>{tr('lx.folders.clean')}{premiumLocked && <b className="lx-pro">PRO</b>}</button>
                  </>
                )}
                {f.removable.length === 0 && unread > 0 && (
                  <button className="lx-btn ghost small" disabled={importing} onClick={() => void useStore.getState().importGalleryFolder(f.id)}>{tr('lx.folders.read', { count: unread })}</button>
                )}
                {f.removable.length === 0 && unread === 0 && <span className="lx-pill ok">✓</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
