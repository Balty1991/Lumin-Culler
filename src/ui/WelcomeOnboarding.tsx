import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { readWelcomeSeen, writeWelcomeSeen } from '../state/welcomeOnboarding';
import { ApertureIcon, SparkleIcon, UserCheckIcon, StarIcon, XIcon } from './icons';
import { LocaleToggle } from './LocaleToggle';
import { t } from '../i18n';

/**
 * ui/WelcomeOnboarding.tsx
 * Ecran de bun venit, aratat O SINGURA DATA (readWelcomeSeen/writeWelcomeSeen),
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
const STEPS = [
  { Icon: ApertureIcon, titleKey: 'welcome.step1.title', bodyKey: 'welcome.step1.body' },
  { Icon: SparkleIcon, titleKey: 'welcome.step2.title', bodyKey: 'welcome.step2.body' },
  { Icon: UserCheckIcon, titleKey: 'welcome.step3.title', bodyKey: 'welcome.step3.body' },
  { Icon: StarIcon, titleKey: 'welcome.step4.title', bodyKey: 'welcome.step4.body' }
] as const;

export function WelcomeOnboarding() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [seen, setSeen] = useState(readWelcomeSeen);
  const [step, setStep] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const open = !seen;
  useModalFocusTrap(containerRef, open);

  if (!open) return null;

  const finish = () => { writeWelcomeSeen(); setSeen(true); };
  const isLast = step === STEPS.length - 1;
  const { Icon, titleKey, bodyKey } = STEPS[step];

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

        <div className="welcome-onboarding-dots" role="tablist" aria-label={tr('welcome.progress', { current: step + 1, total: STEPS.length })}>
          {STEPS.map((_, i) => (
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
