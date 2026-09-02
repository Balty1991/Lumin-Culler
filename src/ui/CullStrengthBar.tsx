import { useMemo } from 'react';
import { useStore } from '../state/store';
import { deriveThresholds } from '../core/scoreThresholds';
import { previewAllStrictness, STRICTNESS_LEVELS } from '../core/strictnessPreview';
import { isUserDecided } from '../state/batchOps';
import { AnimatedNumber } from './AnimatedNumber';
import { t } from '../i18n';

/**
 * ui/CullStrengthBar.tsx
 * Cat de exigent e motorul — pe ecranul principal, cu raspunsul deja pe masa.
 *
 * Setarea exista si in Meniu (o lista de trei pastile). Aici e altceva, si de-aia
 * merita loc pe ecranul principal: fiecare treapta isi arata REZULTATUL inainte
 * s-o alegi. Nu "sunt sever", ci "sever inseamna 34 pastrate in loc de 51".
 *
 * De ce conteaza, in cuvintele pietei: la Aftershoot, Narrative si FilterPixel
 * alegi nivelul de severitate si apoi astepti sa ruleze din nou culling-ul ca sa
 * vezi ce ai facut. Cifrele de aici nu cer nicio rulare — scorul fiecarei poze e
 * deja calculat si nu depinde de severitate, se muta doar pragurile, deci
 * rezultatul e cunoscut dinainte. Vezi core/strictnessPreview.ts.
 *
 * Se ascunde complet cand nu are ce compara: fara poze nedecise, cele trei
 * coloane ar arata acelasi zero de trei ori.
 */
export function CullStrengthBar() {
  const photos = useStore(s => s.photos);
  const locale = useStore(s => s.locale);
  const current = useStore(s => s.cullingStrictness);
  const setCullingStrictness = useStore(s => s.setCullingStrictness);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  /**
   * Pragurile bibliotecii INAINTE de severitate, din scorurile deja in memorie.
   * Aceeasi functie pe care o foloseste si motorul; scorurile sunt aceleasi ca
   * in Dexie, doar ca nu mai asteptam o citire pentru un numar pe care il avem.
   */
  const outcomes = useMemo(() => {
    const sorted = photos.map(p => p.aiScore).sort((a, b) => a - b);
    return previewAllStrictness(photos, deriveThresholds(sorted));
  }, [photos]);

  const undecided = useMemo(() => photos.filter(p => !isUserDecided(p.status)).length, [photos]);
  /** Treapta bifata acum; cade pe prima daca vreodata ar lipsi din lista. */
  const activeOutcome = outcomes.find(o => o.strictness === current) ?? outcomes[0];
  if (undecided === 0) return null;

  return (
    <section className="cull-strength" aria-label={tr('strictness.title')}>
      <header className="cull-strength-head">
        <span className="cull-strength-eyebrow mono">{tr('strictness.bar.eyebrow')}</span>
        <span className="cull-strength-sub">{tr('strictness.bar.sub', { count: undecided })}</span>
      </header>

      <div className="cull-strength-row" role="group">
        {STRICTNESS_LEVELS.map((level, i) => {
          const o = outcomes[i];
          const active = level === current;
          return (
            <button
              key={level}
              type="button"
              className={active ? 'cull-strength-cell is-on' : 'cull-strength-cell'}
              aria-pressed={active}
              /* Eticheta pentru cititoarele de ecran spune si cifra: altfel ar
                 anunta doar "Sever", adica exact informatia care era si inainte
                 in meniu, si tot rostul barii s-ar pierde acolo unde ecranul nu
                 se vede. */
              aria-label={tr('strictness.bar.aria', {
                level: tr(`strictness.${level}`), left: o.review, kept: o.kept, rejected: o.rejected
              })}
              onClick={() => { void setCullingStrictness(level); }}
            >
              <b className="cull-strength-name">{tr(`strictness.${level}`)}</b>
              {/* Cifra mare e cat ITI RAMANE, nu cate se pastreaza: aia e munca
                  pe care o simti, si singura pe care severitatea chiar o
                  schimba. Vezi core/strictnessPreview.ts pentru de ce nu poate
                  fi "cate pastrezi" fara sa minta. */}
              <span className="cull-strength-kept" aria-hidden="true">
                <AnimatedNumber value={o.review} />
              </span>
              <span className="cull-strength-legend" aria-hidden="true">{tr('strictness.bar.left')}</span>
            </button>
          );
        })}
      </div>

      {/* Detaliul apare O SINGURA DATA, pentru treapta aleasa — nu in fiecare
          celula. In fiecare celula se rupea pe doua randuri pe telefon, facea
          casetele inegale, si punea sase cifre pe ecran acolo unde comparatia
          utila e intre trei. */}
      <p className="cull-strength-detail" aria-hidden="true">
        {tr('strictness.bar.auto', { kept: activeOutcome.kept, rejected: activeOutcome.rejected })}
      </p>

      <p className="cull-strength-note">{tr('strictness.hint')}</p>
    </section>
  );
}
