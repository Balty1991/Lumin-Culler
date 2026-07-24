import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { t } from '../i18n';

/**
 * Dialog de confirmare/prompt TEMATIZAT — inlocuieste window.confirm/window.prompt
 * in toata aplicatia (PersonsPanel, BatchOpsPanel, InsightsPanel, CommandPalette,
 * App.tsx). Popup-ul nativ de browser nu respecta tema dark/light si sparge
 * iluzia de aplicatie completa; acesta foloseste acelasi `.detail`/`.detail-inner
 * narrow` ca restul panourilor modale, deci vine "gratis" cu stilul corect.
 *
 * Randat o singura data in App.tsx, condus integral de `dialogRequest` din store
 * (vezi askConfirm/askPrompt) — nu are propriul state de deschis/inchis.
 */
export function ConfirmDialog() {
  const dialogRequest = useStore(s => s.dialogRequest);
  const resolveDialog = useStore(s => s.resolveDialog);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  useModalFocusTrap(containerRef, dialogRequest !== null);

  useEffect(() => {
    if (dialogRequest?.kind === 'prompt') setValue(dialogRequest.defaultValue ?? '');
  }, [dialogRequest]);

  if (!dialogRequest) return null;

  const cancel = () => resolveDialog(dialogRequest.kind === 'confirm' ? false : null);
  const confirm = () => resolveDialog(dialogRequest.kind === 'confirm' ? true : value);

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        className="detail-inner narrow confirm-dialog" ref={containerRef} role="alertdialog" aria-modal="true"
        aria-label={dialogRequest.message} tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') cancel();
          else if (e.key === 'Enter' && dialogRequest.kind === 'prompt') { e.preventDefault(); confirm(); }
        }}
      >
        <p className="confirm-dialog-message">{dialogRequest.message}</p>
        {dialogRequest.kind === 'prompt' && (
          <input
            className="confirm-dialog-input" type="text" value={value} autoFocus
            onChange={e => setValue(e.target.value)}
          />
        )}
        <div className="confirm-dialog-actions">
          <button className="ghost" onClick={cancel}>{dialogRequest.cancelLabel ?? tr('confirmDialog.cancel')}</button>
          <button
            className={dialogRequest.kind === 'confirm' && dialogRequest.danger ? 'reject' : 'btn-accent'}
            onClick={confirm} autoFocus={dialogRequest.kind === 'confirm'}
          >
            {dialogRequest.confirmLabel ?? tr('confirmDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
