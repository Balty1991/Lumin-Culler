import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import { readLastModelLoadMs } from '../core/modelLoadTiming';
import { formatEta } from '../core/formatTime';

/**
 * ui/AiBootScreen.tsx
 * Ecran dedicat pentru faza 'incarcare' a importului (modelele AI se
 * incarca/warmup) — inlocuieste bara de progres plata + text, care lasa
 * un gol vizual mare dedesubt cat timp progress.total nu are inca sens
 * (nu stim cate secunde mai dureaza). Nucleu animat (halou care pulseaza,
 * inel rotativ, respiratie usoara) + bara indeterminata + pastile ce
 * enumera CE anume pregateste AI-ul. Concept vizual din artifact-ul
 * "LuminCuller — concept HUD", portat pe token-urile deja existente.
 */
export function AiBootScreen() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);

  // nu exista un "N din M" real pentru incarcare+warmup (spre deosebire de
  // analiza per-poza) — dar un cronometru simplu ("a trecut Xs") + estimarea
  // memorata din ultima incarcare reusita pe acest device (workerPool.ts,
  // modelLoadTiming.ts) tot raspund la intrebarea reala a utilizatorului:
  // "cat mai am de asteptat" — vezi si feedback-ul direct primit pe acest ecran.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rememberedMs] = useState(() => readLastModelLoadMs());
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, []);

  // Acelasi invelis ca ecranul de progres al importului (vezi App.tsx,
  // .analysis-studio): incarcarea modelelor si analiza sunt doua etape ale
  // aceleiasi asteptari, iar pana acum aratau ca doua ecrane fara legatura —
  // primul static, fiindca animatia lui fusese incetinita la 8s, deci in
  // secunda cat se vede nu se misca nimic vizibil.
  return (
    <section className="analysis-studio" role="status" aria-live="polite">
      <div className="analysis-studio-glow" aria-hidden="true" />
      <div className="analysis-studio-head">
        <span className="analysis-studio-kicker">{tr('app.progress.studioKicker')}</span>
        <span className="analysis-studio-count">
          {elapsedMs >= 1000 ? formatEta(elapsedMs / 1000) : '…'}
        </span>
      </div>
      <div className="analysis-studio-lens" aria-hidden="true">
        <span className="analysis-studio-orbit orbit-one" />
        <span className="analysis-studio-orbit orbit-two" />
        <span className="analysis-studio-core" />
      </div>
      <div className="analysis-studio-copy">
        <h2>{tr('app.boot.title')}</h2>
        <p>{tr('app.progress.loadingModels')}</p>
        {elapsedMs >= 1000 && (
          // aria-hidden — bug real gasit de auditul UI: acest text se schimba la
          // FIECARE secunda, iar intreg ecranul e o regiune `aria-live="polite"`.
          // Rezultatul: TalkBack/VoiceOver reciteau "au trecut 6s… 7s… 8s…" fara
          // oprire. Informatia utila e deja anuntata o data, din titlu.
          <p className="analysis-studio-elapsed mono" aria-hidden="true">
            {rememberedMs !== null
              ? tr('app.boot.elapsedWithEstimate', { time: formatEta(elapsedMs / 1000), estimate: formatEta(rememberedMs / 1000) })
              : tr('app.boot.elapsed', { time: formatEta(elapsedMs / 1000) })}
          </p>
        )}
      </div>
      {/* Bara nu are procent real aici — durata incarcarii modelelor nu se stie
          dinainte — deci se misca singura, ca semn ca lucreaza. */}
      <div className="analysis-studio-progress is-indeterminate" aria-hidden="true"><span /></div>
      <div className="analysis-studio-steps" aria-hidden="true">
        <span className="active">{tr('app.boot.pill.faces')}</span>
        <span>{tr('app.boot.pill.composition')}</span>
        <span>{tr('app.boot.pill.sharpness')}</span>
      </div>
    </section>
  );
}
