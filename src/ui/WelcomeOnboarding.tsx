import { useRef, useState, type SVGProps } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { ApertureIcon, SparkleIcon, UserCheckIcon, StarIcon, XIcon, ShieldIcon, CheckIcon } from './icons';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { LocaleToggle } from './LocaleToggle';
import { t } from '../i18n';

/**
 * ui/WelcomeOnboarding.tsx
 * Ecran de bun venit, aratat O SINGURA DATA (welcomeSeen/dismissWelcome in
 * state/store.ts, persistat de state/welcomeOnboarding.ts),
 * inainte ca utilizatorul sa fi importat vreo poza — nu explica UI-ul (butoane,
 * meniuri), ci raspunde la "de ce sa folosesc asta": procesare 100% locala,
 * cum functioneaza scorul AI, recunoasterea persoanelor (si limita ei gratuita),
 * si o previzualizare onesta a Premium (inca fara mecanism real de plata — vezi
 * core/entitlement.ts).
 *
 * Layout: ecran PLIN, nu foaie de jos (mockup 01 din prezentare) — fundal cu
 * glow violet+turcoaz, o pastila-iconita cu gradientul de brand, o singura
 * promisiune si un CTA rotunjit. Inainte reutiliza sasiul de dialog
 * (.detail/.detail-inner), care il randa ca un sheet lipit de marginea de jos,
 * cu jumatatea de sus goala si intunecata — exact opusul primei impresii pe
 * care o arata mockup-ul. Pasii raman 4 (fiecare spune ceva real), doar
 * prezentarea lor s-a schimbat.
 */
interface Step {
  Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element;
  titleKey: string;
  bodyKey: string;
  /** Ilustratie proprie, sub text — deocamdata doar pasul de permisiuni. */
  visual?: 'permission';
}

const BASE_STEPS: Step[] = [
  { Icon: ApertureIcon, titleKey: 'welcome.step1.title', bodyKey: 'welcome.step1.body' },
  { Icon: SparkleIcon, titleKey: 'welcome.step2.title', bodyKey: 'welcome.step2.body' },
  { Icon: UserCheckIcon, titleKey: 'welcome.step3.title', bodyKey: 'welcome.step3.body' },
  { Icon: StarIcon, titleKey: 'welcome.step4.title', bodyKey: 'welcome.step4.body' }
];

/**
 * Pasul despre permisiunea de galerie, ULTIMUL — deci ultimul lucru citit
 * inainte ca utilizatorul sa apese "Alege fotografiile" si sa primeasca
 * dialogul de sistem.
 *
 * Android 14+ arata trei optiuni, iar cea evidentiata vizual ("Permite cu acces
 * limitat") e exact cea GRESITA pentru aplicatia asta: cu acces partial vedem
 * doar pozele bifate manual atunci, deci "Adu pe perioade" si Supervizorul
 * galeriei (care numara ce ai de sortat pe fiecare luna) nu mai au ce citi.
 * Utilizatorul apasa butonul albastru, fiindca asa arata un buton principal, si
 * ajunge intr-o aplicatie care pare stricata fara sa inteleaga de ce.
 *
 * Doar pe native: pe web/PWA nu exista dialogul asta, iar un pas care ar
 * explica ceva ce nu se intampla ar fi doar zgomot.
 */
const PERMISSION_STEP: Step = {
  Icon: ShieldIcon, titleKey: 'welcome.permission.title', bodyKey: 'welcome.permission.body', visual: 'permission'
};

function buildSteps(): Step[] {
  return isNativeMediaLibraryAvailable() ? [...BASE_STEPS, PERMISSION_STEP] : BASE_STEPS;
}

export function WelcomeOnboarding() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  // Starea "vazut" sta in store, nu local: si App-ul trebuie sa o citeasca, ca
  // sa nu randeze bannerele peste acest ecran (vezi welcomeSeen in state/store.ts).
  const seen = useStore(s => s.welcomeSeen);
  const dismissWelcome = useStore(s => s.dismissWelcome);
  const [step, setStep] = useState(0);
  // Calculat o singura data: disponibilitatea plugin-ului nu se schimba in timpul rularii.
  const [steps] = useState(buildSteps);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = !seen;
  useModalFocusTrap(containerRef, open);

  if (!open) return null;

  const finish = () => dismissWelcome();
  const isLast = step === steps.length - 1;
  const { Icon, titleKey, bodyKey, visual } = steps[step];

  return (
    <div className="welcome-screen">
      <div
        className="welcome-onboarding" ref={containerRef} role="dialog" aria-modal="true"
        aria-label={tr(titleKey)} tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); finish(); } }}
      >
        <button className="ghost icon-btn welcome-onboarding-skip" onClick={finish} aria-label={tr('welcome.skip')}>
          <XIcon />
        </button>
        <div className="welcome-onboarding-locale">
          <LocaleToggle />
        </div>

        <div className="welcome-onboarding-icon" aria-hidden="true">
          <Icon />
        </div>

        <h2>{tr(titleKey)}</h2>
        <p className="welcome-onboarding-body">{tr(bodyKey)}</p>

        {/* Reproducerea celor trei optiuni ale dialogului Android, cu cea corecta
            marcata. O imagine a alegerii e mult mai greu de inteles gresit decat
            o propozitie care descrie un buton pe care utilizatorul nu-l vede
            inca — mai ales ca sistemul il evidentiaza tocmai pe cel gresit. */}
        {visual === 'permission' && (
          <div className="welcome-permission" aria-hidden="true">
            <span className="welcome-permission-option">{tr('welcome.permission.limited')}</span>
            <span className="welcome-permission-option recommended">
              <CheckIcon />{tr('welcome.permission.all')}
            </span>
            <span className="welcome-permission-option">{tr('welcome.permission.deny')}</span>
          </div>
        )}

        <div className="welcome-onboarding-dots" role="tablist" aria-label={tr('welcome.progress', { current: step + 1, total: steps.length })}>
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'welcome-onboarding-dot active' : 'welcome-onboarding-dot'} aria-hidden="true" />
          ))}
        </div>

        <div className="welcome-onboarding-actions">
          {step > 0 && <button className="ghost" onClick={() => setStep(s => s - 1)}>{tr('welcome.back')}</button>}
          <button className="btn-accent" onClick={() => (isLast ? finish() : setStep(s => s + 1))}>
            {isLast ? tr('welcome.start') : tr('welcome.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
