import { useEffect, useState } from 'react';
import { untrashNativePhotos } from '../core/nativeMediaLibrary';
import { clearLastTrash, onLastTrash } from '../state/lastTrash';
import { useStore } from '../state/store';
import { useTr } from './context';
import { readWholeGallery } from './galleryReader';

/**
 * lumin/UndoBar.tsx
 * După orice mutare în coș: „Am mutat N poze în coș · Anulează”, 10 secunde.
 * Anularea le scoate din coșul galeriei (cu confirmarea Android), iar
 * Cherrypic le recitește.
 */
const SHOW_MS = 10_000;

export function UndoBar() {
  const tr = useTr();
  const [last, setLast] = useState<{ uris: string[]; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => onLastTrash(setLast), []);
  useEffect(() => {
    if (!last) return;
    const timer = window.setTimeout(() => clearLastTrash(), SHOW_MS - (Date.now() - last.at));
    return () => window.clearTimeout(timer);
  }, [last]);
  if (!last) return null;
  const undo = async () => {
    setBusy(true);
    try {
      const r = await untrashNativePhotos(last.uris);
      if (!r.cancelled) {
        useStore.getState().setNotice(tr('lx.undo.done', { count: last.uris.length }));
        void readWholeGallery(true);
      }
    } catch {
      useStore.getState().setNotice(tr('lx.undo.failed'));
    } finally {
      setBusy(false);
      clearLastTrash();
    }
  };
  return (
    <div className="lx-undo" role="status">
      <span>{tr('lx.undo.trashed', { count: last.uris.length })}</span>
      <button className="lx-link" disabled={busy} onClick={() => void undo()}>{tr('lx.undo.button')}</button>
    </div>
  );
}
