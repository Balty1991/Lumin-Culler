import { useStore } from '../state/store';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
import { SparkleIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/**
 * ui/SessionOutcome.tsx
 * Ce a făcut aplicația, spus imediat după ce a făcut-o.
 *
 * Cifrele astea existau toate in StatsPanel — dar acolo trebuie sa te duci
 * singur, printr-un meniu, la un moment ales de tine. Adica exact cand nu mai
 * simti efortul pe care tocmai l-ai evitat. Momentul in care iti dai seama daca
 * o unealta valoreaza ceva e imediat dupa ce a lucrat pentru tine.
 *
 * Doua reguli de continut, amandoua despre incredere:
 *
 * 1. Nicio cifra inventata. Nu scrie "ti-am economisit 50 de minute" — n-avem de
 *    unde sti cat de repede ai fi triat manual. Scrie cate poze ti-au ramas de
 *    verificat din cate ai adus; economia se deduce singura din raportul ala, si
 *    tocmai de aceea e crezuta.
 * 2. Mentiunea despre Premium apare DOAR cand e relevanta factual — cand pozele
 *    pastrate din lotul asta chiar depasesc cat mai poti exporta gratuit luna
 *    asta. Nu la fiecare import, si nu ca reclama: ca o informatie de care ai
 *    nevoie inainte sa apesi Exporta si sa te lovesti de limita.
 */
export function SessionOutcome() {
  const locale = useStore(s => s.locale);
  const outcome = useStore(s => s.sessionOutcome);
  const dismiss = useStore(s => s.dismissSessionOutcome);
  const selectedCount = useStore(s => s.photos.filter(p => p.status === 'selected').length);
  const openUncertainReview = useStore(s => s.openUncertainReview);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  // Din store, nu din entitlement.ts direct: acolo raspunsul e sincron, deci
  // React nu afla ca s-a schimbat dupa o cumparare sau dupa un export. Sus,
  // inaintea oricarui `return` — hook-urile trebuie apelate in aceeasi ordine
  // la fiecare randare, iar cardul asta se intoarce devreme cand nu are ce arata.
  const premium = useStore(s => s.premium);
  const photosUsed = useStore(s => s.photosUsedThisWindow);

  if (!outcome) return null;
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const remaining = premium ? Infinity : Math.max(0, FREE_PHOTOS_PER_MONTH - photosUsed);
  // Doar cand limita chiar sta in calea a ceea ce tocmai ai triat.
  const exportPressure = !premium && selectedCount > remaining;

  return (
    <div className="session-outcome" role="status">
      <button className="ghost icon-btn session-outcome-close" onClick={dismiss} aria-label={tr('app.toast.close')}>
        <XIcon />
      </button>

      <div className="session-outcome-head">
        <SparkleIcon className="inline-icon" />
        <b>{tr('session.title')}</b>
      </div>

      <p className="session-outcome-lead">
        {tr('session.handled', { decided: outcome.autoDecided, imported: outcome.imported })}
      </p>
      <p className="session-outcome-rest">
        {outcome.leftToReview > 0
          ? tr('session.leftToReview', { count: outcome.leftToReview })
          : tr('session.nothingLeft')}
        {/* La plural, nu la fix: scria "1 serii in grupuri" (captura de la utilizator). */}
        {outcome.seriesFound > 0 && ' ' + tr(
          plural(outcome.seriesFound, 'session.series.one', 'session.series.other'),
          { count: outcome.seriesFound }
        )}
      </p>

      {/* Doar cand chiar EXISTA decizii la limita. Bug real raportat de
          utilizator: butonul aparea mereu, iar la apasare raspundea "nicio
          decizie la limita" — un buton care promite ceva si apoi spune ca nu
          exista te invata sa nu-l mai apesi, inclusiv cand are ce arata. */}
      {outcome.uncertain > 0 && (
        <div className="session-outcome-actions">
          <button className="btn-accent" onClick={() => { void openUncertainReview(); dismiss(); }}>
            {tr('session.checkUncertain')}
          </button>
        </div>
      )}

      {exportPressure && (
        <p className="session-outcome-limit">
          {tr('session.exportLimit', { kept: selectedCount, remaining })}{' '}
          <button className="session-outcome-link" onClick={() => { setPremiumOpen(true); dismiss(); }}>
            {tr('session.exportLimit.cta')}
          </button>
        </p>
      )}
    </div>
  );
}
