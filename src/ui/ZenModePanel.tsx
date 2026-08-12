import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon } from './icons';
import { t } from '../i18n';

function ZenSwitch({ on, onToggle, label, disabled }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'zen-switch on' : 'zen-switch off'}
      onClick={onToggle}
    >
      <i aria-hidden="true" />
    </button>
  );
}

/**
 * "Mod Zen" (plan modernizare) — ecran dedicat, nu doar un buton in Meniu:
 * AI-ul rezolva singur grupurile clare (diferenta mare de scor, fara poze cu
 * multe fete — vezi state/zenResolve.ts), te intreaba doar la incertitudini.
 * Cele doua comutatoare controleaza runZenResolve (state/store.ts), rulat
 * automat dupa fiecare import cat timp comutatorul master (zenMode) e activ.
 */
export function ZenModePanel() {
  const open = useStore(s => s.zenPanelOpen);
  const setOpen = useStore(s => s.setZenPanelOpen);
  const zenMode = useStore(s => s.zenMode);
  const setZenMode = useStore(s => s.setZenMode);
  const zenAutoDeleteObvious = useStore(s => s.zenAutoDeleteObvious);
  const setZenAutoDeleteObvious = useStore(s => s.setZenAutoDeleteObvious);
  const zenAskOnUncertain = useStore(s => s.zenAskOnUncertain);
  const setZenAskOnUncertain = useStore(s => s.setZenAskOnUncertain);
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="detail-inner narrow zen-panel" ref={containerRef} role="dialog" aria-modal="true" aria-label={tr('zen.title')} tabIndex={-1}>
        <header className="detail-head">
          <span>{tr('zen.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <div className="zen-orb" aria-hidden="true" />
        <p className="zen-lead">{tr('zen.lead')}</p>

        <button
          type="button"
          className={zenMode ? 'zen-toggle-row zen-master on' : 'zen-toggle-row zen-master'}
          onClick={() => setZenMode(!zenMode)}
        >
          <span>
            <b>{tr('zen.master.title')}</b>
            <span>{tr('zen.master.sub')}</span>
          </span>
          <ZenSwitch on={zenMode} onToggle={() => setZenMode(!zenMode)} label={tr('zen.master.title')} />
        </button>

        <div className="zen-toggle-row">
          <span>
            <b>{tr('zen.autoDelete.title')}</b>
            <span>{tr('zen.autoDelete.sub')}</span>
          </span>
          <ZenSwitch
            on={zenAutoDeleteObvious}
            disabled={!zenMode}
            onToggle={() => setZenAutoDeleteObvious(!zenAutoDeleteObvious)}
            label={tr('zen.autoDelete.title')}
          />
        </div>

        <div className="zen-toggle-row">
          <span>
            <b>{tr('zen.askUncertain.title')}</b>
            <span>{tr('zen.askUncertain.sub')}</span>
          </span>
          <ZenSwitch
            on={zenAskOnUncertain}
            disabled={!zenMode}
            onToggle={() => setZenAskOnUncertain(!zenAskOnUncertain)}
            label={tr('zen.askUncertain.title')}
          />
        </div>
      </div>
    </div>
  );
}
