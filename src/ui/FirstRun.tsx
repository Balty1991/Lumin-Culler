import { useRef, useState } from 'react';
import { HowItWorks } from './HowItWorks';
import { useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import type { CullingStrictness } from '../core/scoreThresholds';
import { useModalFocusTrap } from './useModalFocusTrap';
import { LocaleToggle } from './LocaleToggle';
import { CheckIcon } from './icons';
import { t } from '../i18n';
import { galleryReadEstimate, readWholeGallery, stopGalleryReader } from '../lumin/galleryReader';


const STRICTNESS: CullingStrictness[] = ['lax', 'balanced', 'strict'];

/**
 * ui/FirstRun.tsx
 * Prima deschidere, într-un singur loc (înlocuiește bun-venitul în 6 pași și
 * ecranul de configurare): trei ecrane, apoi antrenamentul din ui/TasteQuiz.tsx.
 *
 * 1. Ce e Lumin: un AI care alege pozele ca tine, pe telefon.
 * 2. Cât de strict să fie (pasul „0” din cercetare: un profil de pornire fără
 *    nicio poză, ca profilul „Lite” al instrumentelor profesionale).
 * 3. Pozele cu care pornim: le alegi tu; varianta automată e a doua.
 *
 * Gustul NU se învață aici, pe poze străine: oamenii își aleg pozele după
 * amintire și după cine e în ele, nu după calitate (vezi
 * reports/Direcție Lumin AI de sortare.md). Se învață imediat după import,
 * pe perechi din galeria lor, cu AI-ul ghicind înainte de fiecare răspuns.
 *
 * Reapare cât timp biblioteca e goală și nu rulează un import: cine a închis
 * selectorul fără să aleagă nimic nu ajunge într-o aplicație goală și mută.
 */
export function FirstRun({ onPickManually }: { onPickManually: () => void }) {
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const dismissWelcome = useStore(s => s.dismissWelcome);
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const locale = useStore(s => s.locale);
  const strictness = useStore(s => s.cullingStrictness);
  const setStrictness = useStore(s => s.setCullingStrictness);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [step, setStep] = useState(welcomeSeen ? 2 : 0);
  const [later, setLater] = useState(false);
  const [demo, setDemo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const open = !later && (!welcomeSeen || (photos.length === 0 && !progress));
  useModalFocusTrap(ref, open);
  if (!open) return null;

  const native = isNativeMediaLibraryAvailable();
  /**
   * Notificarea se cere aici, chiar înainte de import, cu motivul spus pe
   * ecran: fără ea, un import în fundal nu arată nimic pe Android 13+.
   */
  const askNotifications = () => {
    if (isNativeNotificationsAvailable()) void requestNotificationAccess().catch(() => {});
  };
  const pick = () => {
    // A ales să aleagă singur: galeria întreagă nu se mai citește de la sine (o pornește
    // oricând cu „Continuă citirea” pe Azi).
    stopGalleryReader();
    dismissWelcome();
    askNotifications();
    onPickManually();
  };
  const auto = async () => {
    // Nimic nu pornește singur cât omul încă răspunde la întrebarea de mai jos.
    stopGalleryReader();
    dismissWelcome();
    askNotifications();
    // Nu mai așteaptă o săptămână întreagă (raportat: 297 de poze, „simt
    // așteptarea”): Lumi citește galeria de la cele mai noi poze, câte puțin,
    // iar primele apar pe Azi după câteva secunde. Restul vine în fundal.
    setLater(true);
    // Întâi spune cât e de citit și cât durează; pornește doar cu „da”.
    const est = await galleryReadEstimate();
    if (est && est.count > 40) {
      const time = est.minutes < 60 ? tr('fr.estimate.minutes', { minutes: est.minutes }) : tr('fr.estimate.hours', { hours: Math.round(est.minutes / 6) / 10 });
      const ok = await useStore.getState().askConfirm(tr('fr.estimate.ask', { count: est.count, time }), { confirmLabel: tr('fr.estimate.go'), cancelLabel: tr('fr.estimate.later') });
      if (!ok) { stopGalleryReader(); return; }
    }
    void readWholeGallery(true);
  };
  // „Mai târziu” înseamnă chiar mai târziu (raportat: „am dat mai târziu și a început să
  // adauge toată galeria”): nimic nu se citește singur până nu pornește omul citirea.
  const skip = () => { stopGalleryReader(); dismissWelcome(); setLater(true); };

  return (
    <div className="v3-screen fr" role="dialog" aria-modal="true" aria-label={tr('fr.title')} ref={ref} tabIndex={-1}>
      <div className="v3-screen-inner fr-inner">
        <div className="fr-top">
          <div className="fr-dots" aria-hidden="true">
            {[0, 1, 2].map(i => <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}
          </div>
          {step === 0 ? <LocaleToggle /> : <button className="fr-skip" onClick={skip}>{tr('fr.later')}</button>}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{tr('welcome.progress', { current: step + 1, total: 3 })}</span>

        {step === 0 && (
          <section className="fr-step fr-hero" key="intro">
            {/* Scena: trei „poze”, cea din mijloc e aleasă (bifa), celelalte se retrag;
                deasupra, sigla. Arată ce face aplicația înainte de orice cuvânt. */}
            <div className="fr-stage" aria-hidden="true">
              <div className="fr-card left"><i className="sun" /><i className="hill" /><b>✕</b></div>
              <div className="fr-card right"><i className="sun" /><i className="hill" /><b>✕</b></div>
              <div className="fr-card mid"><i className="sun" /><i className="hill" /><b className="ok">✓</b></div>
              <img className="fr-logo" src="icon-192.png" alt="" />
              <span className="fr-spark s1">✦</span><span className="fr-spark s2">✦</span>
            </div>
            <span className="fr-brand">Cherrypic</span>
            <h1 className="fr-title">{tr('fr.hero.title')} <em>{tr('fr.hero.accent')}</em></h1>
            <p className="fr-sub">{tr('fr.hero.sub')}</p>
            <div className="fr-feats">
              <span><i>✦</i>{tr('fr.hero.f1')}</span>
              <span><i>⚡</i>{tr('fr.hero.f2')}</span>
              <span><i>🔒</i>{tr('fr.hero.f3')}</span>
            </div>
            <button className="v3-cta fr-cta" onClick={() => setStep(1)}>
              <span>{tr('fr.start')}</span><span className="v3-mono">→</span>
            </button>
            <button className="fr-demo-link" onClick={() => setDemo(true)}>▶ {tr('fr.demo.open')}</button>
            <p className="fr-trust">{tr('fr.hero.trust')}</p>
            {demo && <HowItWorks tr={tr} onClose={() => setDemo(false)} />}
          </section>
        )}

        {step === 1 && (
          <section className="fr-step" key="strict">
            <span className="v3-kicker">{tr('fr.strict.kicker')}</span>
            <h2 className="fr-title small">{tr('fr.strict.title')}</h2>
            <p className="fr-lead">{tr('fr.strict.lead')}</p>
            <div className="fr-options" role="radiogroup" aria-label={tr('fr.strict.title')}>
              {STRICTNESS.map(value => (
                <button key={value} role="radio" aria-checked={strictness === value}
                  className={strictness === value ? 'fr-option on' : 'fr-option'}
                  onClick={() => void setStrictness(value)}>
                  <span className="fr-option-meter" aria-hidden="true">
                    {[0, 1, 2].map(i => <i key={i} className={i <= STRICTNESS.indexOf(value) ? 'lit' : ''} />)}
                  </span>
                  <span className="fr-option-text">
                    <strong>{tr(`fr.strict.${value}`)}</strong>
                    <span>{tr(`fr.strict.${value}.sub`)}</span>
                  </span>
                  {strictness === value && <CheckIcon />}
                </button>
              ))}
            </div>
            <p className="v3-kicker">{tr('fr.strict.note')}</p>
            <button className="v3-cta" onClick={() => setStep(2)}>
              <span>{tr('welcome.next')}</span><span className="v3-mono">→</span>
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="fr-step" key="photos">
            <span className="v3-kicker">{tr('fr.photos.kicker')}</span>
            <h2 className="fr-title small">{tr('fr.photos.title')}</h2>
            <p className="fr-lead">{tr('fr.photos.lead')}</p>
            {native && (
              <div className="fr-permission" aria-hidden="true">
                <span>{tr('welcome.permission.limited')}</span>
                <span className="recommended"><CheckIcon />{tr('welcome.permission.all')}</span>
                <span>{tr('welcome.permission.deny')}</span>
              </div>
            )}
            {native && <p className="fr-hint">{tr('fr.photos.permission')}</p>}
            {/* Pe telefon, principalul e citirea galeriei (de la cele noi, în fundal); alegerea manuală rămâne a doua. */}
            {native ? (
              <>
                <button className="v3-cta" onClick={() => void auto()}>
                  <span>{tr('fr.photos.readAll')}</span><span className="v3-mono">→</span>
                </button>
                <button className="v3-outline-btn" onClick={pick}>{tr('setup.pick')}</button>
              </>
            ) : (
              <button className="v3-cta" onClick={pick}>
                <span>{tr('setup.pick')}</span><span className="v3-mono">→</span>
              </button>
            )}
            <p className="v3-kicker v3-center">{tr('aiProfile.private')}</p>
          </section>
        )}
      </div>
    </div>
  );
}
