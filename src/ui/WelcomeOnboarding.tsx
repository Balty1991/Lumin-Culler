import { useRef, useState, type SVGProps } from 'react';
import { useStore } from '../state/store';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { requestMissingPermissions } from '../core/appPermissions';
import { useModalFocusTrap } from './useModalFocusTrap';
import { ApertureIcon, SparkleIcon, UserCheckIcon, StarIcon, XIcon, ShieldIcon, CheckIcon, InfoIcon } from './icons';
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
 * Pasul despre permisiunea de galerie.
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

/**
 * Pozitia pasului de permisiuni: AL DOILEA, imediat dupa "ce face aplicatia".
 *
 * A fost ultimul, cu un motiv real — asa era ultimul lucru citit inainte de
 * dialogul de sistem, deci cel mai proaspat in minte. Cerinta directa a
 * utilizatorului l-a mutat in fata, si compromisul e acceptat constient: cine
 * inchide ecranul dupa doua pasi (cazul frecvent) vedea inainte fix zero
 * informatii despre alegerea care poate strica aplicatia. Trei ecrane de
 * distanta pana la dialog costa putina prospetime; a nu ajunge niciodata la el
 * costa tot.
 *
 * Nu-l punem PRIMUL: un ecran care cere permisiuni inainte sa fi spus ce e
 * aplicatia e exact tiparul pe care oamenii au invatat sa-l refuze.
 *
 * Plasa de siguranta ramane oricum ui/PhotosAccessNotice.tsx, care apare cand
 * accesul chiar E limitat — singurul moment in care sfatul e verificabil, nu
 * doar prevenit.
 */
const PERMISSION_STEP_INDEX = 1;

/**
 * Pasul despre notificari — si singurul loc din care permisiunea chiar se CERE.
 *
 * Raportat de utilizator, cu capturi: comutatorul "Notificari inteligente"
 * arata PORNIT, dar bara de stare nu afisa nimic in timpul unui import in
 * fundal. Cauza: `POST_NOTIFICATIONS` se cerea DOAR din acel comutator, iar pe
 * Android 13+ o permisiune necerută e refuzata implicit. Serviciul de analiza
 * pornea si lucra, doar ca notificarea lui era invizibila — adica exact
 * singurul lucru care ii spune omului ca importul merge mai departe.
 *
 * Cuvintele lui: "trebuie pus in info de start cand accesezi prima data
 * aplicatia, cum se da aprobare pentru galerie poze, sa se dea si pentru
 * notificari". Asa e — permisiunea de galerie are un declansator natural
 * (prima citire din galerie), notificarile n-aveau niciunul.
 *
 * Sta imediat DUPA pasul de galerie: cele doua ecrane despre permisiuni raman
 * impreuna, iar dialogul de sistem apare dupa ce omul a citit de ce.
 */
const NOTIFICATION_STEP: Step = {
  Icon: InfoIcon, titleKey: 'welcome.notifications.title', bodyKey: 'welcome.notifications.body'
};

function buildSteps(): Step[] {
  const steps = [...BASE_STEPS];
  // Ordinea insertiilor conteaza: notificarile intai, ca dupa a doua insertie
  // (galeria, pe acelasi index) sa ajunga imediat DUPA ea.
  if (isNativeNotificationsAvailable()) steps.splice(PERMISSION_STEP_INDEX, 0, NOTIFICATION_STEP);
  if (isNativeMediaLibraryAvailable()) steps.splice(PERMISSION_STEP_INDEX, 0, PERMISSION_STEP);
  return steps;
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

  /**
   * Inchiderea ecranului, pe ORICE drum: X, Escape, sau ultimul pas.
   *
   * Cere permisiunile ramase, si o face mai ales pentru drumul cu X. Raportat de
   * utilizator de doua ori, a doua oara dupa ce pasul dedicat exista deja: "cand
   * am dat x la info start tot nu mi-a aparut sa dau acord permisiuni notificare,
   * decat cele de galerie". Fireste — X sare peste pasul care le cerea, iar
   * galeria scapa fiindca si-o cere singura la prima citire. Cuvintele lui: "fa
   * o singura permisiune dupa instalare chiar daca dau x, sa le actualizeze pe
   * toate".
   *
   * `requestMissingPermissions` cere DOAR ce lipseste, una dupa alta: cine a
   * trecut prin pasul de notificari si a acceptat nu mai e intrebat a doua oara,
   * iar doua dialoguri cerute odata s-ar calca pe picioare.
   *
   * Nu duce nimeni in Setarile sistemului de aici, desi acolo se ajunge din
   * rubrica Permisiuni: la prima instalare nimic nu e refuzat definitiv, iar un
   * om abia intrat in aplicatie n-are ce cauta in Setarile telefonului.
   *
   * Inchiderea se face INTAI: ecranul dispare pe loc, ca pana acum, si dialogul
   * de sistem vine peste aplicatia adevarata, nu peste o pagina de intampinare
   * pe care omul tocmai a inchis-o.
   */
  const finish = () => {
    dismissWelcome();
    void requestMissingPermissions().catch(() => { /* un refuz nu e o eroare */ });
  };
  /**
   * Plecarea de pe pasul curent. Pe pasul de notificari cere permisiunea
   * INAINTE de a merge mai departe: dialogul de sistem apare dupa ce omul a
   * citit la ce foloseste, nu peste un ecran pe care nu l-a vazut.
   *
   * Raspunsul nu se verifica si nu opreste nimic. Un refuz e o alegere, iar
   * ecranul de intampinare nu e locul in care sa insisti — analiza merge mai
   * departe oricum, doar fara sa spuna cat a ajuns.
   */
  const leaveStep = async () => {
    if (steps[step] === NOTIFICATION_STEP) {
      try { await requestNotificationAccess(); } catch { /* un refuz nu opreste intampinarea */ }
    }
    if (isLast) finish(); else setStep(s => s + 1);
  };
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

        {/* Doua bug-uri reale de accesibilitate gasite de auditul UI:
            1. `role="tablist"` pe un container ai carui copii sunt <span>-uri
               `aria-hidden`, fara niciun `role="tab"` — o structura ARIA
               invalida (un tablist FARA file), pe care cititoarele de ecran o
               anunta ca o lista de file goala.
            2. Trecerea de la un pas la altul nu era anuntata deloc: focusul
               ramane pe butonul "Inainte", al carui text nu se schimba, iar
               titlul/corpul se inlocuiesc tacut mai sus in ecran. Un utilizator
               de cititor de ecran apasa "Inainte" si nu primea nicio confirmare
               ca s-a intamplat ceva.
            Punctele raman pur decorative; progresul devine un text real intr-o
            regiune `aria-live`, deci fiecare pas se anunta o singura data. */}
        <div className="welcome-onboarding-dots">
          {steps.map((_, i) => (
            <span key={i} className={i === step ? 'welcome-onboarding-dot active' : 'welcome-onboarding-dot'} aria-hidden="true" />
          ))}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {tr('welcome.progress', { current: step + 1, total: steps.length })}
        </span>

        <div className="welcome-onboarding-actions">
          {step > 0 && <button className="ghost" onClick={() => setStep(s => s - 1)}>{tr('welcome.back')}</button>}
          <button className="btn-accent" onClick={() => { void leaveStep(); }}>
            {isLast ? tr('welcome.start') : tr('welcome.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
