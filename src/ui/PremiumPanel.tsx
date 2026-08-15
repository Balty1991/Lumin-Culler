import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, StarIcon, UserCheckIcon, DownloadIcon, SparkleIcon, TagIcon, PlayIcon, CheckIcon, PinIcon } from './icons';
import { FREE_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS, refreshEntitlement } from '../core/entitlement';
import { isBillingAvailable, queryPremiumPrice, startSubscription } from '../core/billing';
import { t } from '../i18n';

/**
 * ui/PremiumPanel.tsx
 * Ecranul "Premium".
 *
 * Are TREI stari, si asta e tot rostul lui:
 *  1. abonat            -> confirmare + de unde se gestioneaza abonamentul;
 *  2. neabonat, cu plata disponibila -> pretul real de la Play + butonul de cumparare;
 *  3. neabonat, fara plata disponibila (web/PWA, produs neconfigurat inca)
 *                       -> "in curand", si nu se cere nimic.
 *
 * Starea 1 lipsea cu totul (bug gasit la audit): cine platise deschidea ecranul
 * si vedea in continuare "Aboneaza-te — 19,99 lei", fara nicio confirmare ca e
 * deja abonat. In cel mai bun caz il speria, in cel mai rau il trimitea intr-un
 * al doilea flux de cumparare, unde Play il oprea cu o eroare tehnica.
 *
 * Beneficiile listate sunt limitele REALE din entitlement.ts (plafonul de poze
 * scoase si numarul de persoane inrolabile), nu functii inventate.
 *
 * De ce citeste starea din store si nu direct din entitlement.ts: acolo
 * raspunsul e sincron, deci React n-ar afla ca s-a schimbat imediat dupa
 * cumparare. Vezi AppState.premium.
 */
export function PremiumPanel() {
  const open = useStore(s => s.premiumOpen);
  const setOpen = useStore(s => s.setPremiumOpen);
  const persons = useStore(s => s.persons);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const premium = useStore(s => s.premium);
  const photosUsed = useStore(s => s.photosUsedThisWindow);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  /** null = inca nu stim (Play n-a raspuns, produs neconfigurat, web) — NU inventam un pret. */
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Rezultatul ultimei restaurari: null = n-a cerut-o inca in sesiunea asta. */
  const [restored, setRestored] = useState<'none' | 'found' | null>(null);

  useEffect(() => {
    if (!open) { setFailed(false); setRestored(null); return; }
    let alive = true;
    void queryPremiumPrice().then(p => { if (alive) setPrice(p); });
    // Reintrebam Play de fiecare data cand se deschide ecranul: intre timp
    // abonamentul poate fi expirat, anulat sau cumparat pe alt dispozitiv, iar
    // asta e exact ecranul pe care utilizatorul vine sa afle care e situatia.
    void refreshEntitlement();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

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
          <StarIcon className="inline-icon" aria-hidden="true" /> {tr(premium ? 'premium.chip.active' : 'premium.chip')}
        </span>
        <h3 className="premium-lead">{tr(premium ? 'premium.lead.active' : 'premium.lead')}</h3>

        <div className="premium-perk">
          <i aria-hidden="true"><DownloadIcon /></i>
          <span>
            <b>{tr('premium.perk.export.title')}</b>
            <span>{tr('premium.perk.export.sub', { limit: FREE_PHOTOS_PER_MONTH })}</span>
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
          <i aria-hidden="true"><TagIcon /></i>
          <span>
            <b>{tr('premium.perk.pro.title')}</b>
            <span>{tr('premium.perk.pro.sub')}</span>
          </span>
        </div>
        <div className="premium-perk">
          <i aria-hidden="true"><PlayIcon /></i>
          <span>
            <b>{tr('premium.perk.show.title')}</b>
            <span>{tr('premium.perk.show.sub')}</span>
          </span>
        </div>
        {/* Rand propriu, nu o vorba in subtitlul de mai sus: era pomenit acolo
            printre altele si utilizatorul, care CHIAR are ecranul blocat, n-a
            observat ca plateste pentru el. */}
        <div className="premium-perk">
          <i aria-hidden="true"><PinIcon /></i>
          <span>
            <b>{tr('premium.perk.locations.title')}</b>
            <span>{tr('premium.perk.locations.sub')}</span>
          </span>
        </div>
        {/* Ultimul, deliberat: e singurul lucru din lista pe care nu-l are
            nimeni altcineva, si se retine mai bine la final decat la mijloc. */}
        <div className="premium-perk">
          <i aria-hidden="true"><SparkleIcon /></i>
          <span>
            <b>{tr('premium.perk.composite.title')}</b>
            <span>{tr('premium.perk.composite.sub')}</span>
          </span>
        </div>
        <div className="premium-perk">
          <i aria-hidden="true"><CheckIcon /></i>
          <span>
            <b>{tr('premium.perk.local.title')}</b>
            <span>{tr('premium.perk.local.sub')}</span>
          </span>
        </div>

        {/* Un abonat nu are de ce sa vada cat i-a mai ramas dintr-un plafon pe
            care nu-l mai are — vezi remainingFreePhotos(), care intoarce Infinity. */}
        <div className="premium-usage">
          {premium ? (
            <b>{tr('premium.usage.titlePremium', { count: photosUsed })}</b>
          ) : (
            <>
              <b>{tr('premium.usage.title', { count: photosUsed, limit: FREE_PHOTOS_PER_MONTH })}</b>
              <span>{tr('premium.usage.persons', { count: persons.length, limit: FREE_ENROLLED_PERSONS })}</span>
            </>
          )}
        </div>

        {premium ? (
          /* Starea care lipsea complet: confirmare, si de unde se gestioneaza
             abonamentul. Anularea se face DOAR din Google Play — asa cere Play,
             si oricum aplicatia n-are cum s-o faca in locul lui. */
          <p className="premium-soon" role="status">{tr('premium.manage')}</p>
        ) : isBillingAvailable() && price ? (
          /* Butonul apare doar cand Play chiar a confirmat ca exista ceva de
             cumparat: `price` nenul inseamna produs configurat SI build semnat.
             Un buton care deschide un flux inexistent e mai rau decat un anunt. */
          <>
            <button
              className="btn-accent big premium-subscribe"
              disabled={busy}
              onClick={() => {
                setBusy(true); setFailed(false);
                void startSubscription()
                  .then(async outcome => {
                    // NU mai inchidem ecranul la cumparare reusita: refreshEntitlement()
                    // comuta starea, iar utilizatorul ramane exact aici si VEDE
                    // confirmarea. Inainte ecranul disparea fara niciun cuvant,
                    // adica singura confirmare a unei plati era absenta ei.
                    if (outcome === 'purchased') await refreshEntitlement();
                    else if (outcome === 'unavailable') setFailed(true);
                    // 'cancelled' = utilizatorul s-a razgandit; nimic de spus
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? tr('premium.subscribing') : tr('premium.subscribe', { price })}
            </button>
            {failed && <p className="premium-soon" role="alert">{tr('premium.failed')}</p>}
            {/* Cerinta Google Play pentru orice aplicatie cu abonamente, si o
                nevoie reala: dupa reinstalare sau pe un telefon nou, contul are
                abonamentul, dar cache-ul local (vezi entitlement.ts) e gol. Fara
                butonul asta, singura solutie era sa astepte o pornire cu retea. */}
            <button
              className="ghost premium-restore"
              disabled={busy}
              onClick={() => {
                setBusy(true); setRestored(null);
                void refreshEntitlement()
                  .then(active => setRestored(active ? 'found' : 'none'))
                  .finally(() => setBusy(false));
              }}
            >
              {tr('premium.restore')}
            </button>
            {restored === 'none' && <p className="premium-soon" role="status">{tr('premium.restore.none')}</p>}
          </>
        ) : (
          <p className="premium-soon">{tr('premium.soon')}</p>
        )}
      </div>
    </div>
  );
}
