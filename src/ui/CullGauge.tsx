import { useStore } from '../state/store';
import { t } from '../i18n';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * ui/CullGauge.tsx
 * Panou HUD compact: gauge circular segmentat (selectate/verificat/respinse,
 * ca un donut, nu bara plata) + grid 2x2 de statistici + buton Goleste
 * sesiunea — inlocuieste .cullbar-compact. Concept vizual din artifact-ul
 * "LuminCuller — concept HUD" (cerut explicit de utilizator), portat pe
 * token-urile de design deja existente in styles.css (--pick/--review/--reject,
 * --accent), nu pe paleta indicativa din mockup.
 */
const RADIUS = 32;
const CIRC = 2 * Math.PI * RADIUS;

interface CullGaugeProps {
  selected: number;
  review: number;
  rejected: number;
  /** Pozele tinute deoparte de om. Vezi PhotoStatus in core/db.ts. */
  candidate: number;
  pending: number;
  total: number;
  onClearSession: () => void;
}

export function CullGauge({ selected, review, rejected, candidate, pending, total, onClearSession }: CullGaugeProps) {
  const locale = useStore(s => s.locale);
  const startQuickReview = useStore(s => s.startQuickReview);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const denom = Math.max(1, total);
  const selLen = (selected / denom) * CIRC;
  const revLen = (review / denom) * CIRC;
  const rejLen = (rejected / denom) * CIRC;
  const canLen = (candidate / denom) * CIRC;
  // Candidatul intra in "decise": e o hotarare a omului ("o tin deoparte"), nu o
  // poza care asteapta sa fie privita. Inainte cadea in `pending`, adica exact
  // pe dos — inelul spunea ca n-ai apucat sa te uiti la ea.
  const donePercent = Math.round(((selected + candidate + rejected) / denom) * 100);

  return (
    <div className="hud">
      <span className="bracket tl" aria-hidden="true" />
      <span className="bracket tr" aria-hidden="true" />
      <span className="bracket bl" aria-hidden="true" />
      <span className="bracket br" aria-hidden="true" />
      <div className="hud-row">
        <div className="gauge">
          <svg viewBox="0 0 76 76" aria-hidden="true">
            <circle cx="38" cy="38" r={RADIUS} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
            {selLen > 0 && (
              <circle cx="38" cy="38" r={RADIUS} fill="none" stroke="var(--pick)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${selLen} ${CIRC}`} strokeDashoffset="0" />
            )}
            {revLen > 0 && (
              <circle cx="38" cy="38" r={RADIUS} fill="none" stroke="var(--review)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${revLen} ${CIRC}`} strokeDashoffset={-selLen} />
            )}
            {canLen > 0 && (
              <circle cx="38" cy="38" r={RADIUS} fill="none" stroke="var(--review)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${canLen} ${CIRC}`} strokeDashoffset={-(selLen + revLen)} opacity="0.55" />
            )}
            {rejLen > 0 && (
              <circle cx="38" cy="38" r={RADIUS} fill="none" stroke="var(--reject)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${rejLen} ${CIRC}`} strokeDashoffset={-(selLen + revLen + canLen)} />
            )}
          </svg>
          <div className="gauge-pct" title={tr('app.hud.doneHint', { pct: donePercent })}>
            <b><AnimatedNumber value={donePercent} />%</b>
            <span>{tr('app.hud.done')}</span>
          </div>
        </div>
        {/* Cu dala de candidati, statisticile devin CINCI. Intr-o grila de doua
            coloane asta inseamna un al treilea rand, iar indicatorul creste cu
            o inaltime de rand — masurat, exact atat cat trebuie ca butonul
            "Golește sesiunea" de dedesubt sa ajunga sub bara de navigare, pe o
            pagina care nu se deruleaza. Cu trei coloane, cinci dale incap in
            aceleasi doua randuri ca patru, deci inaltimea nu se schimba. */}
        <div className={candidate > 0 ? 'hud-stats cols-3' : 'hud-stats'} aria-label={tr('app.cullbar.ariaLabel')}>
          <div className="stat"><i className="sel" aria-hidden="true" /><b><AnimatedNumber value={selected} /></b><span>{tr('app.cullbar.selected')}</span></div>
          {review > 0 ? (
            <button className="stat stat-btn" onClick={startQuickReview} title={tr('app.cullbar.quickReview')}>
              <i className="rev" aria-hidden="true" /><b><AnimatedNumber value={review} /></b><span>{tr('app.cullbar.review')}</span>
            </button>
          ) : (
            <div className="stat"><i className="rev" aria-hidden="true" /><b><AnimatedNumber value={review} /></b><span>{tr('app.cullbar.review')}</span></div>
          )}
          <div className="stat"><i className="rej" aria-hidden="true" /><b><AnimatedNumber value={rejected} /></b><span>{tr('app.cullbar.rejected')}</span></div>
          {/* Doar cand exista: o dala pe zero, in permanenta, ar ocupa un sfert
              din grila cu o informatie pe care majoritatea sesiunilor n-o au. */}
          {candidate > 0 && (
            <div className="stat"><i className="can" aria-hidden="true" /><b><AnimatedNumber value={candidate} /></b><span>{tr('app.cullbar.candidate')}</span></div>
          )}
          <div className="stat"><i className="pen" aria-hidden="true" /><b><AnimatedNumber value={pending} /></b><span>{tr('app.hud.pending')}</span></div>
        </div>
      </div>
      <button className="hud-clear" onClick={onClearSession}>{tr('app.clearSession')}</button>
    </div>
  );
}
