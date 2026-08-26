import { useStore } from '../state/store';
import { t } from '../i18n';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * ui/CullGauge.tsx
 * Randul de progres de deasupra grilei din Bibliotecă.
 *
 * A fost un card de 370px: donut de 76px, patru-cinci dale de statistici pe
 * doua randuri, si butonul "Goleste sesiunea" pe toata latimea. Raportat de
 * utilizator cu captura — pe un telefon de 412px, prima miniatura incepea la
 * jumatatea ecranului, deci tabul "Biblioteca" arata orice altceva inainte de
 * biblioteca.
 *
 * Fiecare bucata din card exista deja in alta parte, mai bine spusa:
 *  - cifrele pe stari  -> pastilele de filtru de dedesubt, care le poarta acum
 *                         permanent (inainte doar cea activa avea numar);
 *  - "de verificat"    -> insigna de pe "Revizuiesc" din bara de jos;
 *  - "Goleste sesiunea"-> masa de triaj de pe Acasa (HomeDashboard), unde o
 *                         actiune ireversibila are loc sa fie insotita de
 *                         context. Deasupra grilei era doar un buton rosu la
 *                         un deget distanta de poze.
 *
 * Ce ramane e singurul lucru pe care nu-l spune nimeni altcineva: cat din
 * sesiune e decis. Un procent, o bara segmentata cu aceleasi culori ca inelul
 * de pe Acasa, si totalul. Un rand, ~40px.
 */
interface CullGaugeProps {
  selected: number;
  review: number;
  rejected: number;
  /** Pozele tinute deoparte de om. Vezi PhotoStatus in core/db.ts. */
  candidate: number;
  pending: number;
  total: number;
}

export function CullGauge({ selected, review, rejected, candidate, pending, total }: CullGaugeProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  const denom = Math.max(1, total);
  const pct = (n: number) => (n / denom) * 100;
  // Candidatul intra in "decise": e o hotarare a omului ("o tin deoparte"), nu o
  // poza care asteapta sa fie privita. Inainte cadea in `pending`, adica exact
  // pe dos — inelul spunea ca n-ai apucat sa te uiti la ea.
  const donePercent = Math.round(((selected + candidate + rejected) / denom) * 100);

  // Bara e decorativa (aria-hidden): cifrele exacte sunt in pastilele de filtru
  // de dedesubt, iar aici se citeste o singura propozitie, compusa din aceleasi
  // etichete traduse — nu patru repere fara nume.
  const aria = [
    `${donePercent}% ${tr('app.hud.done')}`,
    `${selected} ${tr('app.cullbar.selected')}`,
    `${review} ${tr('app.cullbar.review')}`,
    `${rejected} ${tr('app.cullbar.rejected')}`,
    `${pending} ${tr('app.hud.pending')}`
  ].join(', ');

  return (
    <div className="hud-slim" role="group" aria-label={`${tr('app.cullbar.ariaLabel')}: ${aria}`}>
      <span className="hud-slim-pct" title={tr('app.hud.doneHint', { pct: donePercent })}>
        <b><AnimatedNumber value={donePercent} />%</b>
        <span>{tr('app.hud.done')}</span>
      </span>
      <span className="hud-slim-bar" aria-hidden="true">
        {selected > 0 && <i className="sel" style={{ width: `${pct(selected)}%` }} />}
        {candidate > 0 && <i className="can" style={{ width: `${pct(candidate)}%` }} />}
        {review > 0 && <i className="rev" style={{ width: `${pct(review)}%` }} />}
        {rejected > 0 && <i className="rej" style={{ width: `${pct(rejected)}%` }} />}
      </span>
      <span className="hud-slim-total mono" aria-hidden="true">{total}</span>
    </div>
  );
}
