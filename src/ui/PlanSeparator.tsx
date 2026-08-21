import type { PlanBand } from '../state/reviewPlan';
import { t, plural, type Locale } from '../i18n';

/**
 * Un titlu de banda in grila: ce fel de munca urmeaza si cate poze sunt.
 *
 * Sta pe toata latimea grilei (vezi .plan-separator in CSS): o celula obisnuita
 * ar aseza titlul intr-o coloana si ar impinge pozele langa el, adica exact
 * contrariul a ceea ce trebuie sa faca un separator.
 */
export function PlanSeparator({ band, locale }: { band: PlanBand; locale: Locale }) {
  return (
    <div className="plan-separator" role="presentation">
      <span className="plan-separator-title mono">{t(locale, `plan.band.${band.key}`)}</span>
      <span className="plan-separator-sub">
        {t(locale, plural(band.count, `plan.band.${band.key}.one`, `plan.band.${band.key}.other`), { count: band.count })}
      </span>
    </div>
  );
}
