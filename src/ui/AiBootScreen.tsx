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
        {/* inel SVG cu 3 arce de culoare solida (nu conic-gradient + mask CSS, nici
            un gradient liniar) — mult mai ieftin de rotit continuu pe telefoane
            slabe, si spre deosebire de un gradient liniar (care se roteste ca un
            tot rigid si abia se "citeste" ca miscare), benzi de culoare distincte
            se vad clar maturand cercul, la fel ca vechiul conic-gradient */}
        <svg className="core-ring" viewBox="0 0 108 108" aria-hidden="true">
          <circle cx="54" cy="54" r="50" fill="none" stroke="var(--accent)" strokeWidth="4" strokeDasharray="104.72 314.16" strokeDashoffset="0" />
          <circle cx="54" cy="54" r="50" fill="none" stroke="#8b5cf6" strokeWidth="4" strokeDasharray="104.72 314.16" strokeDashoffset="-104.72" />
          <circle cx="54" cy="54" r="50" fill="none" stroke="var(--accent-2)" strokeWidth="4" strokeDasharray="104.72 314.16" strokeDashoffset="-209.44" />
        </svg>
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
