import { useStore } from '../state/store';
import { t, plural } from '../i18n';
import { PinIcon } from './icons';

interface ConsolaStep {
  key: string;
  title: string;
  sub: string;
  go: string;
  onClick: () => void;
}

interface HomePlanConsolaProps {
  greeting: string;
  unsortedCount: number;
  duplicateGroupCount: number;
  recapCount: number;
  donePercent: number;
  decidedCount: number;
  totalCount: number;
  totalGB: string;
  streak: number;
  tripCount: number;
  onOpenSort: () => void;
  onOpenDuplicates: () => void;
  onOpenRecap: () => void;
}

/**
 * Consola (plan modernizare) — "Acasa" ca plan de actiune numerotat, in loc de
 * o vitrina de carduri separate. Randata DOAR cand visualTheme === 'consola'
 * (vezi HomeDashboard.tsx), care ii da valorile deja calculate acolo — nicio
 * cifra noua/inventata, doar o alta prezentare a lor. Butoanele declanseaza
 * EXACT aceleasi actiuni reale ca varianta implicita (setTiktokSortOpen etc.),
 * fara o stare "finalizat" simulata local — ecranul se schimba pentru ca
 * actiunea chiar s-a intamplat, nu pentru ca am mimat un progres.
 */
export function HomePlanConsola({
  greeting, unsortedCount, duplicateGroupCount, recapCount, donePercent, decidedCount, totalCount, totalGB,
  streak, tripCount, onOpenSort, onOpenDuplicates, onOpenRecap
}: HomePlanConsolaProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const sessionDate = new Date()
    .toLocaleDateString(locale === 'en' ? 'en-US' : 'ro-RO', { day: '2-digit', month: 'short' })
    .toUpperCase();

  const steps: ConsolaStep[] = [];
  if (unsortedCount > 0) {
    steps.push({
      key: 'sort',
      title: tr('home.sortCta.title'),
      sub: tr(plural(unsortedCount, 'home.sortCta.sub.one', 'home.sortCta.sub.other'), { count: unsortedCount }),
      go: tr('consola.step.go'),
      onClick: onOpenSort
    });
  }
  if (duplicateGroupCount > 0) {
    steps.push({
      key: 'dup',
      title: tr('consola.step.duplicates.title'),
      sub: tr(plural(duplicateGroupCount, 'duplicates.count.one', 'duplicates.count.other'), { count: duplicateGroupCount }),
      go: tr('consola.step.go'),
      onClick: onOpenDuplicates
    });
  }
  if (recapCount > 0) {
    steps.push({
      key: 'recap',
      title: tr('home.recap.title'),
      sub: tr(plural(recapCount, 'home.recap.sub.one', 'home.recap.sub.other'), { count: recapCount }),
      go: tr('consola.step.view'),
      onClick: onOpenRecap
    });
  }

  return (
    <div className="consola-plan">
      <div className="consola-greet-row">
        <b>{greeting}</b>
        <span className="consola-session">{tr('consola.session', { date: sessionDate })}</span>
      </div>

      <div className="consola-panel">
        <p className="consola-panel-lbl">{tr('consola.progress')}</p>
        <div className="consola-panel-num">{donePercent}%</div>
        <div className="consola-bar-track"><div className="consola-bar-fill" style={{ width: `${donePercent}%` }} /></div>
        <div className="consola-tele-row">
          <div><b>{totalCount}</b>{tr('consola.tele.total')}</div>
          <div><b>{decidedCount}</b>{tr('consola.tele.decided')}</div>
          <div><b>{unsortedCount}</b>{tr('consola.tele.review')}</div>
          <div><b>{totalGB}</b>GB</div>
        </div>
      </div>

      {steps.length > 0 && (
        <>
          <div className="consola-plan-head">
            <span>{tr('consola.plan.title')}</span>
            <span>{tr(plural(steps.length, 'consola.plan.count.one', 'consola.plan.count.other'), { count: steps.length })}</span>
          </div>
          <div className="consola-step-list">
            {steps.map((step, i) => (
              <button key={step.key} className={i === 0 ? 'consola-step current' : 'consola-step'} onClick={step.onClick}>
                <span className="consola-step-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="consola-step-txt"><b>{step.title}</b><span>{step.sub}</span></span>
                <span className="consola-step-go">{step.go}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {(streak > 1 || tripCount > 0) && (
        <div className="consola-chip-row">
          {streak > 1 && (
            <div className="consola-chip">
              <b>🔥 {streak}</b>
              <span>{tr(plural(streak, 'home.streak.label.one', 'home.streak.label.other'), { count: streak })}</span>
            </div>
          )}
          {tripCount > 0 && (
            <div className="consola-chip">
              <b><PinIcon className="inline-icon" aria-hidden="true" /> {tripCount}</b>
              <span>{tr(plural(tripCount, 'home.trips.label.one', 'home.trips.label.other'), { count: tripCount })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
