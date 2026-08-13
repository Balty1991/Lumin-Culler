import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { AdjustedImage } from './AdjustedImage';
import { hasVaultPin, isValidPinFormat } from '../core/vault';
import { LockIcon, XIcon, TrashIcon } from './icons';
import { t, plural } from '../i18n';

function VaultThumb({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void db.thumbnails.get(photoId).then(rec => { if (rec && alive) { url = URL.createObjectURL(rec.blob); setSrc(url); } });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return src ? <AdjustedImage src={src} alt="" loading="lazy" /> : <span className="memory-thumb-loading" aria-hidden="true" />;
}

/**
 * "Dosar privat" (plan modernizare, ecran m-vault din mockup) — blocat cu PIN
 * local, nu amprenta (niciun plugin biometric Capacitor nu exista inca in
 * proiect, vezi core/vault.ts). Trei stari posibile: fara PIN inca (setup),
 * cu PIN dar blocat (deblocare), deblocat (continutul folderului, vizibil
 * DOAR aici — filtrat din grila principala/CollectionsPanel/CollectionPicker
 * cat timp e blocat, vezi store.ts filtered()/secondaryFiltered()).
 */
export function VaultPanel() {
  const open = useStore(s => s.vaultOpen);
  const setOpen = useStore(s => s.setVaultOpen);
  const vaultUnlocked = useStore(s => s.vaultUnlocked);
  const setupVault = useStore(s => s.setupVault);
  const unlockVault = useStore(s => s.unlockVault);
  const lockVault = useStore(s => s.lockVault);
  const disableVault = useStore(s => s.disableVault);
  const removeFromVault = useStore(s => s.removeFromVault);
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  const openDetail = useStore(s => s.openDetail);
  const askConfirm = useStore(s => s.askConfirm);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPin = hasVaultPin();

  useEffect(() => {
    if (!open) { setPin(''); setConfirmPin(''); setError(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const vaultCollection = collections.find(c => c.isPrivate);
  const vaultPhotos = useMemo(() => {
    if (!vaultCollection) return [];
    const ids = new Set(vaultCollection.memberIds);
    return photos.filter(p => ids.has(p.id));
  }, [photos, vaultCollection]);

  if (!open) return null;

  const submitSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isValidPinFormat(pin)) { setError(tr('vault.error.format')); return; }
    if (pin !== confirmPin) { setError(tr('vault.error.mismatch')); return; }
    setBusy(true);
    try { await setupVault(pin); } finally { setBusy(false); }
  };

  const submitUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ok = await unlockVault(pin);
      if (!ok) { setError(tr('vault.error.wrong')); setPin(''); }
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    const ok = await askConfirm(tr('vault.disable.confirm'), { danger: true, confirmLabel: tr('vault.disable.cta') });
    if (!ok) return;
    await disableVault();
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('vault.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><LockIcon className="inline-icon" aria-hidden="true" /> {tr('vault.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {!hasPin && (
          <form className="vault-form" onSubmit={e => void submitSetup(e)}>
            <p className="hint">{tr('vault.setup.lead')}</p>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoFocus
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={tr('vault.setup.pinPlaceholder')} aria-label={tr('vault.setup.pinPlaceholder')}
            />
            <input
              type="password" inputMode="numeric" pattern="[0-9]*"
              value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={tr('vault.setup.confirmPlaceholder')} aria-label={tr('vault.setup.confirmPlaceholder')}
            />
            {error && <p className="notice warn mono">{error}</p>}
            <button type="submit" className="btn-accent" disabled={busy}>{tr('vault.setup.cta')}</button>
          </form>
        )}

        {hasPin && !vaultUnlocked && (
          <form className="vault-form" onSubmit={e => void submitUnlock(e)}>
            <p className="hint">{tr('vault.unlock.lead')}</p>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoFocus
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={tr('vault.unlock.pinPlaceholder')} aria-label={tr('vault.unlock.pinPlaceholder')}
            />
            {error && <p className="notice warn mono">{error}</p>}
            <button type="submit" className="btn-accent" disabled={busy || !pin}>{tr('vault.unlock.cta')}</button>
          </form>
        )}

        {hasPin && vaultUnlocked && (
          <>
            <div className="vault-toolbar">
              <button className="ghost small" onClick={lockVault}>{tr('vault.lockNow')}</button>
              <button className="ghost small danger" onClick={() => void confirmDisable()}>{tr('vault.disable.cta')}</button>
            </div>
            {vaultPhotos.length === 0 ? (
              <p className="hint">{tr('vault.empty')}</p>
            ) : (
              <>
                <p className="mono">{tr(plural(vaultPhotos.length, 'vault.count.one', 'vault.count.other'), { count: vaultPhotos.length })}</p>
                <div className="memory-grid">
                  {vaultPhotos.map(photo => (
                    <div key={photo.id} className="vault-thumb-wrap">
                      <button className="memory-thumb" aria-label={photo.fileName} onClick={() => { setOpen(false); openDetail(photo.id); }}>
                        <VaultThumb photoId={photo.id} />
                      </button>
                      <button
                        className="vault-thumb-remove"
                        onClick={() => void removeFromVault([photo.id])}
                        aria-label={tr('vault.removeOne')}
                        title={tr('vault.removeOne')}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
