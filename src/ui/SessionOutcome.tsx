import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { FREE_PHOTOS_PER_MONTH } from '../core/entitlement';
import { db } from '../core/db';
import { medianDecisionSeconds, estimateSecondsSaved } from '../core/decisionPace';
import { selectDeletableRejected } from '../state/batchOps';
import { sumKnownSizeBytes, formatGB } from '../state/storageStats';
import { getCachedThumbUrl } from '../core/thumbUrlCache';
import { formatEta } from '../core/formatTime';
import { SparkleIcon, XIcon, TrashIcon } from './icons';
import { AnimatedNumber } from './AnimatedNumber';
import { t, plural } from '../i18n';

/** Cate miniaturi apar in banda de sus. Patru incap pe orice telefon, la un rand. */
const STRIP_SIZE = 4;

/**
 * Banda cu cele mai bune poze din lot.
 *
 * De ce merita locul: pana acum, ecranul care anunta rezultatul nu arata NICIO
 * poza. Spunea "312 pastrate" unui om care tocmai adusese 1284 de fotografii si
 * nu vazuse inca niciuna dintre ele. Patru miniaturi transforma o cifra intr-un
 * lucru la care te uiti — si sunt si singura dovada ca cifra e despre pozele
 * tale, nu despre o statistica.
 */
function TopStrip({ ids }: { ids: string[] }) {
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map(id => getCachedThumbUrl(id))).then(list => { if (alive) setUrls(list); });
    return () => { alive = false; };
  }, [ids]);

  if (ids.length === 0) return null;
  return (
    <div className="session-outcome-strip" aria-hidden="true">
      {ids.map((id, i) => (
        <span key={id} className="session-outcome-thumb">
          {urls[i] && <img src={urls[i]!} alt="" loading="lazy" />}
        </span>
      ))}
    </div>
  );
}

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
  const photos = useStore(s => s.photos);
  const setHomeGridOpen = useStore(s => s.setHomeGridOpen);
  const setFilter = useStore(s => s.setFilter);

  /**
   * Ritmul TAU, din momentele deciziilor tale (CorrectionRecord.ts).
   *
   * Citit o singura data, la aparitia cardului: e o interogare pe un index, dar
   * pe o biblioteca lunga tot nu e ceva de facut la fiecare randare. `null`
   * inseamna "inca nu stiu", si atunci randul de timp economisit nu se
   * afiseaza deloc — vezi core/decisionPace.ts.
   */
  const [paceSeconds, setPaceSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!outcome) return;
    let alive = true;
    void db.corrections.orderBy('ts').keys().then(keys => {
      if (alive) setPaceSeconds(medianDecisionSeconds(keys as number[]));
    }).catch(() => { /* fara ritm nu se afiseaza nimic; nu e o eroare de raportat */ });
    return () => { alive = false; };
  }, [outcome]);

  /**
   * Cat spatiu ar elibera stergerea respinselor — cifre reale, nu estimari.
   *
   * DOAR pozele chiar stergibile (`deletable`), nu toate respinsele: pe web si
   * pentru pozele importate inainte ca aplicatia sa retina URI-ul nativ,
   * stergerea din stocare nu e posibila. A numara si acele MB ar promite un
   * spatiu care nu se elibereaza — vezi selectDeletableRejected.
   */
  const freeableBytes = useMemo(
    () => sumKnownSizeBytes(selectDeletableRejected(photos).deletable),
    [photos]
  );

  /** Cele mai bune poze pastrate, ca banda de sus sa arate ceva, nu doar cifre. */
  const topIds = useMemo(
    () => photos.filter(p => p.status === 'selected')
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, STRIP_SIZE)
      .map(p => p.id),
    [photos]
  );

  if (!outcome) return null;
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const remaining = premium ? Infinity : Math.max(0, FREE_PHOTOS_PER_MONTH - photosUsed);
  // Doar cand limita chiar sta in calea a ceea ce tocmai ai triat.
  const exportPressure = !premium && selectedCount > remaining;
  const savedSeconds = estimateSecondsSaved(outcome.autoDecided, paceSeconds);

  return (
    <div className="session-outcome" role="status">
      <button className="ghost icon-btn session-outcome-close" onClick={dismiss} aria-label={tr('app.toast.close')}>
        <XIcon />
      </button>

      <div className="session-outcome-head">
        <SparkleIcon className="inline-icon" />
        <b>{tr('session.title')}</b>
      </div>

      {/* CIFRA-EROU. Era o propozitie ("a decis singur 1 200 din 1 284"), adica
          exact informatia potrivita spusa in forma care se citeste cel mai
          greu. Rezultatul unui import de o mie de poze merita sa fie un numar
          la care te uiti, nu un rand de text pe care il parcurgi. */}
      <div className="session-outcome-hero">
        <b><AnimatedNumber value={selectedCount} /></b>
        <span>{tr('session.hero.kept')}</span>
      </div>

      <TopStrip ids={topIds} />

      {/* TIMPUL, si numai cand chiar se poate spune onest.
          `estimateSecondsSaved` intoarce null pana cand exista destule decizii
          ale tale din care sa iasa un ritm real — vezi core/decisionPace.ts.
          Baza ("la ritmul tau de X s") sta mereu langa cifra: cine vede din ce
          iese numarul poate sa-l judece singur, si asta e diferenta dintre o
          masuratoare si o reclama. */}
      {savedSeconds !== null && paceSeconds !== null && (
        <div className="session-outcome-saved">
          <b>{tr('session.saved', { time: formatEta(savedSeconds) })}</b>
          <span>{tr('session.saved.basis', { pace: paceSeconds.toFixed(1) })}</span>
        </div>
      )}

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
      {/* Spatiul, langa restul: e singurul motiv pentru care multi oameni deschid
          o aplicatie de poze, si pana acum nu aparea nicaieri in acest ecran.
          Doar cand chiar exista ceva de eliberat. */}
      {freeableBytes > 0 && (
        <p className="session-outcome-space">
          <TrashIcon className="inline-icon" aria-hidden="true" />
          {tr('session.space', { size: formatGB(freeableBytes) })}
        </p>
      )}

      <div className="session-outcome-actions">
        {/* Actiunea principala lipsea cu totul: cardul anunta un rezultat si nu
            oferea nicio cale spre el. Duce direct in grila, filtrata pe pastrate
            — adica exact pozele despre care tocmai a vorbit. */}
        {selectedCount > 0 && (
          <button
            className="btn-accent session-outcome-primary"
            onClick={() => { setFilter('selected'); setHomeGridOpen(true); dismiss(); }}
          >
            {tr('session.seeKept', { count: selectedCount })}
          </button>
        )}
        {outcome.uncertain > 0 && (
          <button className="ghost session-outcome-secondary" onClick={() => { void openUncertainReview(); dismiss(); }}>
            {tr('session.checkUncertain')}
          </button>
        )}
      </div>

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
