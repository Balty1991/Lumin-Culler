import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, StarIcon, UserCheckIcon, DownloadIcon, SparkleIcon } from './icons';
import { FREE_EXPORT_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS, exportsInRollingMonth } from '../core/entitlement';
import { refreshEntitlement } from '../core/entitlement';
import { isBillingAvailable, queryPremiumPrice, startSubscription } from '../core/billing';
import { t } from '../i18n';

/**
 * ui/PremiumPanel.tsx
 * Ecranul "Premium" din mockup-ul 21, cu o diferenta deliberata: mockup-ul are
 * un buton "Începe 7 zile gratuit", aplicatia NU are niciun mecanism de plata
 * (vezi core/entitlement.ts — Google Play Billing nu e cablat, isPremium() e
 * mereu false, iar depasirea plafonului doar informeaza, nu blocheaza). Un
 * buton de proba ar promite ceva ce nimeni nu poate onora azi, asa ca ecranul
 * spune "în curând" si nu cere nimic.
 *
 * Beneficiile listate sunt limitele REALE din entitlement.ts (plafonul lunar
 * de export si numarul de persoane inrolabile), nu cele trei din mockup, care
 * descriau functii fara acoperire in cod ("recapuri nelimitate" — recapul nu e
 * plafonat azi; "aspecte exclusive" — toate cele 4 accente sunt gratuite).
 * Randul de folosire arata unde esti chiar acum fata de plafon.
 */
export function PremiumPanel() {
  const open = useStore(s => s.premiumOpen);
  const setOpen = useStore(s => s.setPremiumOpen);
  const persons = useStore(s => s.persons);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  /** null = inca nu stim (Play n-a raspuns, produs neconfigurat, web) — NU inventam un pret. */
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) { setFailed(false); return; }
    let alive = true;
    void queryPremiumPrice().then(p => { if (alive) setPrice(p); });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const exported = exportsInRollingMonth();

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="detail-inner narrow" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('premium.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span>{tr('premium.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <span className="premium-chip">
          <StarIcon className="inline-icon" aria-hidden="true" /> {tr('premium.chip')}
        </span>
        <h3 className="premium-lead">{tr('premium.lead')}</h3>

        <div className="premium-perk">
          <i aria-hidden="true"><DownloadIcon /></i>
          <span>
            <b>{tr('premium.perk.export.title')}</b>
            <span>{tr('premium.perk.export.sub', { limit: FREE_EXPORT_PHOTOS_PER_MONTH })}</span>
          </span>
        </div>
        <div className="premium-perk">
          <i aria-hidden="true"><UserCheckIcon /></i>
          <span>
            <b>{tr('premium.perk.persons.title')}</b>
            <span>{tr('premium.perk.persons.sub', { limit: FREE_ENROLLED_PERSONS })}</span>
          </span>
        </div>
        <div className="premium-perk">
          <i aria-hidden="true"><SparkleIcon /></i>
          <span>
            <b>{tr('premium.perk.local.title')}</b>
            <span>{tr('premium.perk.local.sub')}</span>
          </span>
        </div>

        <div className="premium-usage">
          <b>{tr('premium.usage.title', { count: exported, limit: FREE_EXPORT_PHOTOS_PER_MONTH })}</b>
          <span>{tr('premium.usage.persons', { count: persons.length, limit: FREE_ENROLLED_PERSONS })}</span>
        </div>

        {/* Butonul apare doar cand Play chiar a confirmat ca exista ceva de
            cumparat: `price` nenul inseamna produs configurat SI build semnat.
            Un buton care deschide un flux inexistent e mai rau decat un anunt. */}
        {isBillingAvailable() && price ? (
          <>
            <button
              className="btn-accent big premium-subscribe"
              disabled={busy}
              onClick={() => {
                setBusy(true); setFailed(false);
                void startSubscription()
                  .then(async outcome => {
                    if (outcome === 'purchased') { await refreshEntitlement(); setOpen(false); }
                    else if (outcome === 'unavailable') setFailed(true);
                    // 'cancelled' = utilizatorul s-a razgandit; nimic de spus
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? tr('premium.subscribing') : tr('premium.subscribe', { price })}
            </button>
            {failed && <p className="premium-soon">{tr('premium.failed')}</p>}
          </>
        ) : (
          <p className="premium-soon">{tr('premium.soon')}</p>
        )}
      </div>
    </div>
  );
}
