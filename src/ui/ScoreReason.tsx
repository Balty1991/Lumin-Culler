import { useStore } from '../state/store';
import { explainFactors } from '../core/learning/ContextEngine';
import { t } from '../i18n';
import { SparkleIcon } from './icons';
import type { PhotoView } from '../state/store';

/**
 * ui/ScoreReason.tsx
 * O linie: cat a dat AI-ul, ce verdict inseamna asta, si DIN CE CAUZA.
 *
 * Aplicatia stia deja sa-si motiveze fiecare decizie — `generateExplanation`
 * scrie paragrafe intregi — dar tot ce scria statea intr-o fila ("De ce acest
 * scor") dintr-o foaie care e inchisa implicit. Adica exact argumentul care
 * deosebeste aplicatia asta de o galerie oarecare nu ajungea la om decat daca
 * il cauta. Linia de aici il pune acolo unde se ia decizia, si duce cu un tap
 * la rationamentul complet.
 *
 * Nu costa nimic: `aiFactors` sunt deja in memorie pe fiecare poza (vezi
 * PhotoView in state/store.ts), iar explainFactors e o simpla traducere de
 * etichete — nicio citire din Dexie, niciun pixel decodat.
 */

const KEEP_THRESHOLD = 65;
const REJECT_THRESHOLD = 35;
/** Doua motive, nu trei: al treilea nu mai incape pe un telefon fara sa taie primele doua. */
const MAX_FACTORS = 2;
/**
 * Cate caractere de motiv incap pe un rand de telefon ingust, langa cifra si
 * langa butonul "De ce?". Bugetul se numara in caractere, nu se lasa pe seama
 * lui `text-overflow: ellipsis`, si asta e o alegere: un motiv taiat la mijloc
 * lasa pe ecran bulina lui colorata si nimic altceva langa ea — arata exact ca
 * o eroare de randare (vazut in captura de pe telefon: "Fără date de aparat
 * foto •"). Mai bine un motiv intreg decat doua ciuntite.
 */
const LABEL_BUDGET = 30;

/** Motivele care incap intregi, in ordinea importantei. Primul intra mereu. */
export function fitFactors<T extends { label: string }>(factors: T[], budget = LABEL_BUDGET): T[] {
  const out: T[] = [];
  let used = 0;
  for (const f of factors.slice(0, MAX_FACTORS)) {
    // +2: bulina si spatiul dinaintea motivului
    const cost = f.label.length + (out.length ? 2 : 0);
    if (out.length && used + cost > budget) break;
    out.push(f);
    used += cost;
  }
  return out;
}

export interface ScoreReasonProps {
  photo: PhotoView;
  /** Deschide rationamentul complet. Absent = linia ramane pur informativa. */
  onExplain?: () => void;
}

export function ScoreReason({ photo, onExplain }: ScoreReasonProps) {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);

  const verdictKey = photo.aiScore >= KEEP_THRESHOLD ? 'keep' : photo.aiScore <= REJECT_THRESHOLD ? 'reject' : 'review';
  const factors = fitFactors(explainFactors(photo.aiFactors, locale));

  return (
    <div className={`score-reason score-reason-${verdictKey}`}>
      {/* Cifra poarta deja culoarea verdictului, deci cuvantul ("Păstrează")
          apare doar cand nu exista motive de aratat — altfel ar manca din randul
          de care au nevoie chiar motivele, care spun mai mult. Cititorul de ecran
          il primeste oricum, din eticheta ascunsa de mai jos. */}
      <span className="score-reason-score mono" aria-hidden="true">{photo.aiScore}</span>
      <span className="score-reason-text">
        {factors.length > 0 ? (
          <span className="score-reason-factors">
            {factors.map((f, i) => (
              <span key={i} className={f.positive ? 'score-reason-factor pos' : 'score-reason-factor neg'}>{f.label}</span>
            ))}
          </span>
        ) : (
          <b>{tr(`inspector.verdict.${verdictKey}`)}</b>
        )}
      </span>
      <span className="sr-only">
        {`${photo.aiScore} — ${tr(`inspector.verdict.${verdictKey}`)}${factors.length ? `: ${factors.map(f => f.label).join(', ')}` : ''}`}
      </span>
      {onExplain && (
        <button type="button" className="score-reason-why" onClick={onExplain}>
          <SparkleIcon className="inline-icon" aria-hidden="true" />
          {tr('detail.reason.why')}
        </button>
      )}
    </div>
  );
}
