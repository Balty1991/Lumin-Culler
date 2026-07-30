import { useStore } from '../state/store';
import { t } from '../i18n';
import { SparkleIcon } from './icons';

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
  const tr = (key: string) => t(locale, key);

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
