import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { getCachedPreviewUrl } from '../core/previewUrlCache';
import { selectPendingShieldReview, dismissSensitiveDocument, readShieldDismissedIds } from '../core/documentShield';
import { hasVaultPin } from '../core/vault';
import { ShieldIcon, XIcon } from './icons';
import { t } from '../i18n';

function ShieldPreview({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    void getCachedPreviewUrl(photoId).then(url => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [photoId]);
  return src ? <img className="shield-preview-img" src={src} alt="" /> : <span className="shield-preview-loading" aria-hidden="true" />;
}

/**
 * "Protectie documente/coduri sensibile" (plan modernizare, ecran m-shield
 * din mockup) — conecteaza in sfarsit textCoverage (OCR nativ, calculat deja
 * dar pana acum neexpus utilizatorului, vezi core/documentShield.ts) la un
 * flux real: o coada de revizuit UNA CATE UNA, exact ca in mockup, nu o
 * lista/grila — o singura decizie clara pe rand ("las-o unde e" / "muta in
 * privat"), fara sa oblige la nimic si fara sa reapara la infinit odata
 * decisa (vezi dismissSensitiveDocument).
 */
export function DocumentShieldPanel() {
  const open = useStore(s => s.documentShieldOpen);
  const setOpen = useStore(s => s.setDocumentShieldOpen);
  const photos = useStore(s => s.photos);
  const collections = useStore(s => s.collections);
  const moveToVault = useStore(s => s.moveToVault);
  const setVaultOpen = useStore(s => s.setVaultOpen);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  const [dismissed, setDismissed] = useState(() => readShieldDismissedIds());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const vaultIds = useMemo(() => new Set(collections.find(c => c.isPrivate)?.memberIds ?? []), [collections]);
  const queue = useMemo(() => selectPendingShieldReview(photos, vaultIds, dismissed), [photos, vaultIds, dismissed]);

  if (!open) return null;

  const current = queue[0];

  const skip = () => {
    if (!current) return;
    dismissSensitiveDocument(current.id);
    setDismissed(prev => new Set(prev).add(current.id));
  };

  const moveIn = async () => {
    if (!current || busy) return;
    // Nu mutam nimic intr-un folder inca fara PIN — ar ramane, tehnic, un
    // folder "privat" pe care oricine il poate deschide. Prima data,
    // trimitem intai la configurarea PIN-ului; utilizatorul revine aici din
    // Meniu ca sa continue coada.
    if (!hasVaultPin()) { setOpen(false); setVaultOpen(true); return; }
    setBusy(true);
    try {
      await moveToVault([current.id]);
      dismissSensitiveDocument(current.id);
      setDismissed(prev => new Set(prev).add(current.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('shield.title')} tabIndex={-1}>
        <header className="detail-head">
          <span><ShieldIcon className="inline-icon" aria-hidden="true" /> {tr('shield.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        {!current ? (
          <p className="hint shield-empty">{tr('shield.empty')}</p>
        ) : (
          <>
            <div className="shield-preview">
              <ShieldPreview photoId={current.id} />
            </div>
            <h3 className="shield-question">{tr('shield.question')}</h3>
            <p className="hint">{tr('shield.sub')}</p>
            <div className="shield-row">
              <button className="ghost" onClick={skip} disabled={busy}>{tr('shield.skip')}</button>
              <button className="btn-accent" onClick={() => void moveIn()} disabled={busy}>{tr('shield.moveIn')}</button>
            </div>
            {queue.length > 1 && <p className="mono shield-remaining">{tr('shield.remaining', { count: queue.length - 1 })}</p>}
          </>
        )}
      </div>
    </div>
  );
}
