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
        <span className="core-halo h2" />
        <span className="core-halo h3" />
        {/* inel SVG cu contur (nu conic-gradient + mask CSS pe un div) — mult mai
            ieftin de rotit continuu pe telefoane slabe: un mask radial recalculat
            in fiecare cadru poate sacada vizibil, mai ales cat timp CPU-ul e deja
            ocupat cu incarcarea modelelor AI in fundal (bug real raportat) */}
        <svg className="core-ring" viewBox="0 0 108 108" aria-hidden="true">
          <defs>
            <linearGradient id="coreRingGrad" x1="0" y1="0" x2="108" y2="108" gradientUnits="userSpaceOnUse">
              <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
              <stop offset="55%" style={{ stopColor: '#8b5cf6' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent-2)' }} />
            </linearGradient>
          </defs>
          <circle cx="54" cy="54" r="50" fill="none" stroke="url(#coreRingGrad)" strokeWidth="4" />
        </svg>
        <div className="core-disc">
          <SparkleIcon />
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
