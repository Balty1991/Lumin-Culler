import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { summarizeAccuracy, type AccuracySummary } from '../core/learning/accuracy';
import { useStore } from '../state/store';
import { SparkleIcon } from './icons';
import { AnimatedNumber } from './AnimatedNumber';
import { t } from '../i18n';

/**
 * ui/AiProfileCard.tsx
 * "Cât de bine te cunoaște" — pe ecranul principal, nu ascuns intr-un panou.
 *
 * DE CE EXISTA. Cifra asta se calcula deja (core/learning/accuracy.ts) si se
 * arata deja — dar in Meniu → Preferinte AI, adica intr-un loc pe care il
 * deschide cine e curios, nu cine se intreaba daca poate avea incredere. Or
 * exact a doua categorie e cea care decide daca lasa aplicatia sa hotarasca in
 * locul lui, si daca plateste pentru ea.
 *
 * Argumentul pe care il face cardul asta nu e "AI avansat", ci unul verificabil:
 * din N decizii pe care le-ai luat TU, motorul propusese acelasi lucru in X%
 * din cazuri. Si, cand exista destule, daca procentul creste — adica daca
 * motorul chiar se adapteaza la tine sau doar a nimerit-o bine de la inceput.
 * Diferenta dintre "invata" ca slogan si "invata" ca masuratoare.
 *
 * TREI REGULI, mostenite din accuracy.ts si respectate aici la litera:
 *  - sub MIN_DECISIONS_FOR_ACCURACY decizii nu apare NIMIC. Un procent din
 *    cinci decizii nu e un procent, e o coincidenta afisata cu doua zecimale;
 *  - tendinta apare doar cu doua ferestre pline si care nu se suprapun — altfel
 *    ar compara aceleasi decizii cu ele insele si ar arata mereu o miscare mica;
 *  - tendinta se afiseaza SI CAND E IN JOS. Un indicator care nu poate arata
 *    rau nu e un indicator, e o reclama — iar restul cifrelor din aplicatie se
 *    cred tocmai fiindca asta poate sa nu fie magulitoare.
 *
 * NU recalculeaza nimic si nu traduce greutatile motorului in propozitii: alea
 * sunt treaba panoului Preferinte AI, care le are deja si le are pe context.
 * Cardul arata titlul si duce acolo.
 */

/** Sub atatea puncte procentuale, diferenta dintre ferestre e zgomot, nu tendinta. */
const TREND_NOISE_POINTS = 2;

export function AiProfileCard() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const setInsightsOpen = useStore(s => s.setInsightsOpen);
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);

  useEffect(() => {
    let alive = true;
    // O singura data, la montare: numarul nu se schimba cat stai pe ecranul
    // principal, iar corectiile sunt singura tabela pe care o citim intreaga —
    // e cu ordine de marime mai mica decat biblioteca si, spre deosebire de ea,
    // creste doar cu cat lucrezi efectiv, nu cu fiecare import.
    void db.corrections.toArray()
      .then(rows => { if (alive) setAccuracy(summarizeAccuracy(rows)); })
      .catch(() => { /* fara date cardul pur si simplu nu apare; nu e o eroare de raportat */ });
    return () => { alive = false; };
  }, []);

  if (!accuracy) return null;
  const percent = Math.round(accuracy.agreement * 100);

  /**
   * Tendinta, in puncte procentuale — nu in procente dintr-un procent, care ar
   * fi o a doua cifra ce spune altceva decat pare (o crestere de la 80 la 84 nu
   * e "cu 5% mai bine", e cu 4 puncte).
   */
  const deltaPoints = accuracy.trend
    ? Math.round(accuracy.trend.recent * 100) - Math.round(accuracy.trend.earlier * 100)
    : null;
  const trendKey = deltaPoints === null ? null
    : deltaPoints >= TREND_NOISE_POINTS ? 'home.aiProfile.trend.up'
    : deltaPoints <= -TREND_NOISE_POINTS ? 'home.aiProfile.trend.down'
    : 'home.aiProfile.trend.flat';

  return (
    <button className="home-ai-card" onClick={() => setInsightsOpen(true)} aria-label={tr('home.aiProfile.aria')}>
      <span className="home-ai-num">
        <AnimatedNumber value={percent} />%
      </span>
      <span className="home-ai-text">
        <b>
          <SparkleIcon className="inline-icon" aria-hidden="true" /> {tr('home.aiProfile.label')}
        </b>
        <span>{tr('home.aiProfile.learned', { count: accuracy.total })}</span>
        {trendKey && (
          <span className="home-ai-trend" data-dir={deltaPoints! >= TREND_NOISE_POINTS ? 'up' : deltaPoints! <= -TREND_NOISE_POINTS ? 'down' : 'flat'}>
            {/* `count`, nu un nume propriu: asa primeste `t()` si forma cu
                particula "de" ceruta de gramatica romaneasca la 20+ — vezi i18n/index.ts. */}
            {tr(trendKey, { count: Math.abs(deltaPoints!) })}
          </span>
        )}
      </span>
      <span className="home-ai-go" aria-hidden="true">→</span>
    </button>
  );
}
