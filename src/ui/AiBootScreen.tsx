import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import { SparkleIcon } from './icons';
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

  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="core" aria-hidden="true">
        <span className="core-halo" />
        <div className="core-ring" />
        <div className="core-disc">
          <div className="core-disc-inner">
            <SparkleIcon />
          </div>
        </div>
      </div>
      <div>
        <p className="boot-title">{tr('app.boot.title')}</p>
        <p className="boot-sub">{tr('app.progress.loadingModels')}</p>
        {elapsedMs >= 1000 && (
          <p className="boot-elapsed mono">
            {rememberedMs !== null
              ? tr('app.boot.elapsedWithEstimate', { time: formatEta(elapsedMs / 1000), estimate: formatEta(rememberedMs / 1000) })
              : tr('app.boot.elapsed', { time: formatEta(elapsedMs / 1000) })}
          </p>
        )}
      </div>
      <div className="boot-shimmer" />
      <div className="boot-pills">
        <span className="boot-pill">{tr('app.boot.pill.faces')}</span>
        <span className="boot-pill">{tr('app.boot.pill.composition')}</span>
        <span className="boot-pill">{tr('app.boot.pill.sharpness')}</span>
        <span className="boot-pill">{tr('app.boot.pill.recognition')}</span>
      </div>
    </div>
  );
}
