import type { PlanBand } from '../state/reviewPlan';
import type { SubjectBand } from '../state/libraryGroups';
import { t, plural, type Locale } from '../i18n';

/**
 * Un titlu de banda in grila: ce fel de munca urmeaza si cate poze sunt.
 *
 * Sta pe toata latimea grilei (vezi .plan-separator in CSS): o celula obisnuita
 * ar aseza titlul intr-o coloana si ar impinge pozele langa el, adica exact
 * contrariul a ceea ce trebuie sa faca un separator.
 */
export function PlanSeparator({ band, locale }: { band: PlanBand | SubjectBand; locale: Locale }) {
  // Doua feluri de benzi trec prin acelasi separator: PLANUL de lucru (ce
  // confirmi, ce compari, unde te uiti tu — filtrul "de verificat") si
  // SUBIECTUL (cine apare in poza — filtrul "toate"). Arata la fel fiindca
  // fac acelasi lucru pentru ochi: rup o lista lunga in bucati cu nume.
  const subject = 'kind' in band;
  const title = subject
    ? (band.kind === 'person' ? band.name! : t(locale, `library.band.${band.kind}`))
    : t(locale, `plan.band.${band.key}`);
  const sub = subject
    ? t(locale, plural(band.count, 'library.band.count.one', 'library.band.count.other'), { count: band.count })
    : t(locale, plural(band.count, `plan.band.${band.key}.one`, `plan.band.${band.key}.other`), { count: band.count });

  return (
    <div className="plan-separator" role="presentation">
      <span className="plan-separator-title mono">{title}</span>
      <span className="plan-separator-sub">{sub}</span>
    </div>
  );
}
