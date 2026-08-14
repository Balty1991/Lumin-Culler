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
 * Doar aspectul comutatorului, FARA sa fie el insusi o comanda — folosit cand
 * randul intreg e deja butonul (vezi randul "master" mai jos). Bug real gasit
 * de auditul UI: acolo statea un <ZenSwitch> (adica un <button role="switch">)
 * INAUNTRUL unui alt <button> — HTML invalid, pe care cititoarele de ecran il
 * anunta ca o singura tinta confuza, iar un tap chiar pe comutator declansa
 * ambele handlere (se salva doar din faptul ca amandoua calculau aceeasi
 * valoare noua din acelasi render; orice trecere la forma functionala
 * `setZenMode(v => !v)` ar fi transformat-o instant intr-o "apasare care nu
 * face nimic"). Starea e purtata acum de randul-buton, prin role="switch".
 */
function ZenSwitchVisual({ on }: { on: boolean }) {
  return (
    <span className={on ? 'zen-switch on' : 'zen-switch off'} aria-hidden="true">
      <i />
    </span>
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
          role="switch"
          aria-checked={zenMode}
          // Numele accesibil ramane scurt ("Mod Zen"), ca inainte, cand statea pe
          // comutatorul dinauntru — fara el s-ar calcula din tot continutul
          // randului si ar deveni titlul lipit de subtitlul explicativ.
          aria-label={tr('zen.master.title')}
          className={zenMode ? 'zen-toggle-row zen-master on' : 'zen-toggle-row zen-master'}
          onClick={() => setZenMode(!zenMode)}
        >
          <span>
            <b>{tr('zen.master.title')}</b>
            <span>{tr('zen.master.sub')}</span>
          </span>
          <ZenSwitchVisual on={zenMode} />
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
