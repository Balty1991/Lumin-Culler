import { useState } from 'react';
import { createPortal } from 'react-dom';
import { hasVaultPin, isValidPinFormat } from '../core/vault';
import { useStore } from '../state/store';
import { useTr } from './context';
import { Thumb } from './Thumb';

/**
 * lumin/PrivatePhotos.tsx
 * „Poze private”: ascunse cu un PIN (4–6 cifre), nu apar nicăieri altundeva în
 * Cherrypic. Folosește dosarul privat al aplicației (core/vault.ts); PIN-ul se
 * ține doar ca amprentă (hash), pe telefon. Deblocarea ține până la închiderea
 * aplicației.
 */

/** Ascunde pozele date; la prima folosire cere alegerea PIN-ului. Întoarce dacă s-a făcut. */
export async function hidePhotos(ids: string[], tr: (k: string) => string): Promise<boolean> {
  const st = useStore.getState();
  if (!hasVaultPin()) {
    const pin = (await st.askPrompt(tr('lx.private.choosePin'), '', { confirmLabel: tr('lx.save') }))?.trim();
    if (!pin) return false;
    if (!isValidPinFormat(pin)) { st.setNotice(tr('lx.private.badPin')); return false; }
    await st.setupVault(pin);
  }
  await st.moveToVault(ids);
  st.setNotice(tr('lx.private.hidden'));
  return true;
}

export function PrivatePhotosRow() {
  const tr = useTr();
  const collections = useStore(s => s.collections);
  const askPrompt = useStore(s => s.askPrompt);
  const unlockVault = useStore(s => s.unlockVault);
  const setNotice = useStore(s => s.setNotice);
  const [open, setOpen] = useState(false);
  const count = collections.find(c => c.isPrivate)?.memberIds.length ?? 0;
  const enter = async () => {
    if (!hasVaultPin()) { setNotice(tr('lx.private.howTo')); return; }
    if (!useStore.getState().vaultUnlocked) {
      const pin = (await askPrompt(tr('lx.private.enterPin'), '', { confirmLabel: tr('lx.private.open') }))?.trim();
      if (!pin) return;
      if (!(await unlockVault(pin))) { setNotice(tr('lx.private.wrongPin')); return; }
    }
    setOpen(true);
  };
  return (
    <>
      <button className="lx-row button" onClick={() => void enter()}>
        <span><b>🔒 {tr('lx.private.title')}</b><small>{count ? tr('lx.private.count', { count }) : tr('lx.private.sub')}</small></span>
        <span className="lx-chev" aria-hidden="true">›</span>
      </button>
      {open && <PrivateSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function PrivateSheet({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  const removeFromVault = useStore(s => s.removeFromVault);
  const lockVault = useStore(s => s.lockVault);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = new Set(collections.find(c => c.isPrivate)?.memberIds ?? []);
  const list = photos.filter(p => ids.has(p.id));
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const close = () => { lockVault(); onClose(); };
  return createPortal(
    <div className="lx lx-sheet-wrap" role="dialog" aria-modal="true" onClick={close}>
      <div className="lx-sheet lx-video-sheet" onClick={e => e.stopPropagation()}>
        <h2>🔒 {tr('lx.private.title')}</h2>
        {!list.length && <p className="lx-hint">{tr('lx.private.empty')}</p>}
        <div className="lx-video-grid">
          {list.map(p => (
            <button key={p.id} className={picked.has(p.id) ? 'lx-video-cell chosen' : 'lx-video-cell'} onClick={() => toggle(p.id)}>
              <Thumb id={p.id} lqip={p.lqip} edits={p.edits} />
              <span className="lx-face-check">{picked.has(p.id) ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        <div className="lx-decide-actions">
          <button className="lx-btn ghost" onClick={close}>🔒 {tr('lx.private.lock')}</button>
          <button className="lx-btn primary" disabled={!picked.size} onClick={() => { void removeFromVault([...picked]).then(() => setPicked(new Set())); }}>{tr('lx.private.unhide', { count: picked.size })}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
