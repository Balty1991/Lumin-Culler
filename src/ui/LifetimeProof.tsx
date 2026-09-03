import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { medianDecisionSeconds, estimateSecondsSaved } from '../core/decisionPace';
import { readLifetime, hasLifetimeStory, type LifetimeSavings } from '../state/lifetimeSavings';
import { formatSpan } from '../core/formatTime';
import { ClockIcon } from './icons';
import { t } from '../i18n';
import type { Locale } from '../i18n';

/**
 * ui/LifetimeProof.tsx
 * Cat a lucrat aplicatia pentru tine de cand o folosesti — deasupra pretului.
 *
 * DE CE AICI. Ecranul Premium cerea pana acum o plata sprijinindu-se exclusiv pe
 * ce PROMITE: sapte beneficii, fiecare cu miniatura lui. Nicaieri nu scria ce a
 * facut deja, degeaba, pentru omul care tocmai se uita la buton. Iar aia e
 * singura parte pe care nu trebuie s-o creada pe cuvant: s-a intamplat pe
 * telefonul lui.
 *
 * Blocul asta e argumentul cel mai puternic din ecran tocmai fiindca nu e o
 * promisiune. "Motorul a decis 4 380 de poze in 6 sesiuni, fara sa platesti
 * nimic" spune, fara s-o zica pe fata, si cat de mult ai primit inainte sa ti se
 * ceara ceva, si cat ai pierde daca te opresti.
 *
 * DOUA TREPTE DE ONESTITATE, si a doua e cea care conteaza:
 *  1. sub doua sesiuni nu apare nimic. Un "total" din primul import e ultimul
 *     import spus a doua oara — iar cardul de dupa import l-a spus deja mai bine;
 *  2. timpul apare DOAR daca exista un ritm masurat al tau (core/decisionPace.ts,
 *     minimum 20 de intervale reale). Fara el, blocul nu tace de tot si nu
 *     inventeaza nimic: ramane cu pozele si sesiunile, care sunt numarate, nu
 *     estimate. Un bloc de vanzare care se abtine sa dea cifra mare atunci cand
 *     n-o poate sustine e exact motivul pentru care restul cifrelor lui se cred.
 *
 * Baza ("la ritmul tau masurat de X s pe decizie") sta mereu langa cifra, ca in
 * ui/SessionOutcome.tsx: cine vede din ce iese numarul il poate judeca singur.
 */
export function LifetimeProof({ locale, premium }: { locale: Locale; premium: boolean }) {
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  /** Citit o singura data, la montare: cifra nu se schimba cat timp panoul e deschis. */
  const [lifetime] = useState<LifetimeSavings>(() => readLifetime());
  /** `null` = inca nu stim, sau nu sunt destule decizii ale tale. Vezi core/decisionPace.ts. */
  const [paceSeconds, setPaceSeconds] = useState<number | null>(null);

  const enough = hasLifetimeStory(lifetime);
  useEffect(() => {
    if (!enough) return;
    let alive = true;
    // Doar cheile indexului `ts` — nu inregistrarile intregi. Pe o biblioteca
    // lunga, corectiile sunt multe, iar aici ne trebuie strict momentele.
    void db.corrections.orderBy('ts').keys().then(keys => {
      if (alive) setPaceSeconds(medianDecisionSeconds(keys as number[]));
    }).catch(() => { /* fara ritm se afiseaza doar partea numarata; nu e o eroare */ });
    return () => { alive = false; };
  }, [enough]);

  if (!enough) return null;
  const savedSeconds = estimateSecondsSaved(lifetime.autoDecided, paceSeconds);

  return (
    <section className="lifetime-proof" aria-label={tr('premium.lifetime.aria')}>
      {savedSeconds !== null && paceSeconds !== null ? (
        <>
          <b className="lifetime-proof-hero">
            <ClockIcon className="inline-icon" aria-hidden="true" />
            {tr('premium.lifetime.head', { time: formatSpan(savedSeconds) })}
          </b>
          <span className="lifetime-proof-basis">{tr('premium.lifetime.basis', { pace: paceSeconds.toFixed(1) })}</span>
        </>
      ) : (
        /* Fara ritm masurat, cifra-erou devine ce s-a NUMARAT: pozele. Tot o
           dovada, si una pe care n-o poate contesta nimeni. */
        <b className="lifetime-proof-hero">
          {tr('premium.lifetime.headPhotos', { count: lifetime.imported })}
        </b>
      )}
      <span className="lifetime-proof-tally">
        {tr(premium ? 'premium.lifetime.tally.premium' : 'premium.lifetime.tally', {
          count: lifetime.imported,
          sessions: lifetime.sessions
        })}
      </span>
    </section>
  );
}
