/**
 * ui/InsightsChart.tsx
 * Grafic simplu (bare orizontale, fara dependinte externe) al ponderilor
 * invatate de ContextEngine pentru un context — alimentat direct de
 * `contextEngine.summarize()[].topWeights`, folosit din InsightsPanel.
 * Verde = factor care creste scorul (pondere pozitiva), rosu = il scade.
 */
import { useStore } from '../state/store';
import { t } from '../i18n';

export interface InsightsChartWeight {
  feature: string;
  label: string;
  weight: number;
}

export function InsightsChart({ weights }: { weights: InsightsChartWeight[] }) {
  const locale = useStore(s => s.locale);
  if (!weights.length) return null;
  const maxAbs = Math.max(...weights.map(w => Math.abs(w.weight)), 0.01);

  return (
    <div className="insights-chart" role="img" aria-label={t(locale, 'insightsChart.ariaLabel')}>
      {weights.map(w => {
        const pct = Math.min(100, Math.round((Math.abs(w.weight) / maxAbs) * 100));
        const positive = w.weight >= 0;
        return (
          <div className="insights-chart-row" key={w.feature}>
            <span className="insights-chart-label">{w.label}</span>
            <div className="insights-chart-track">
              <div className={positive ? 'insights-chart-bar pos' : 'insights-chart-bar neg'} style={{ width: `${pct}%` }} />
            </div>
            <span className="insights-chart-value mono">{positive ? '+' : ''}{w.weight.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}
