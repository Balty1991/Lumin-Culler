import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useModalFocusTrap } from './useModalFocusTrap';
import { XIcon, StarIcon, CheckIcon } from './icons';
import { FREE_PHOTOS_PER_MONTH, FREE_ENROLLED_PERSONS, refreshEntitlement } from '../core/entitlement';
import { isBillingAvailable, queryPremiumPrice, queryPlansAnswer, startSubscription, type PremiumPlan } from '../core/billing';
import { annualSavingsPercent, perMonthPrice, defaultPlanId, resolvePlan } from '../core/premiumPlans';
import { t, plural } from '../i18n';
import { PremiumProof } from './PremiumProof';
import { LifetimeProof } from './LifetimeProof';
import { resumeFor } from './premiumResume';

/**
 * ui/PremiumPanel.tsx
 * Ecranul "Premium".
 *
 * Are TREI stari, si asta e tot rostul lui:
 *  1. abonat            -> confirmare + de unde se gestioneaza abonamentul;
 *  2. neabonat, cu plata disponibila -> pretul real de la Play + butonul de cumparare;
 *  3. neabonat, fara plata disponibila (web/PWA, produs neconfigurat inca)
 *                       -> "in curand", si nu se cere nimic.
 *
 * Starea 1 lipsea cu totul (bug gasit la audit): cine platise deschidea ecranul
 * si vedea in continuare "Aboneaza-te — 19,99 lei", fara nicio confirmare ca e
 * deja abonat. In cel mai bun caz il speria, in cel mai rau il trimitea intr-un
 * al doilea flux de cumparare, unde Play il oprea cu o eroare tehnica.
 *
 * Beneficiile listate sunt limitele REALE din entitlement.ts (plafonul de poze
 * scoase si numarul de persoane inrolabile), nu functii inventate.
 *
 * De ce citeste starea din store si nu direct din entitlement.ts: acolo
 * raspunsul e sincron, deci React n-ar afla ca s-a schimbat imediat dupa
 * cumparare. Vezi AppState.premium.
 */
export function PremiumPanel() {
  const open = useStore(s => s.premiumOpen);
  const setOpen = useStore(s => s.setPremiumOpen);
  const persons = useStore(s => s.persons);
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const premium = useStore(s => s.premium);
  const premiumReason = useStore(s => s.premiumReason);

  /**
   * Care rand din lista se marcheaza, pentru ce a apasat omul. Portile
   * contextuale (sapte in aplicatie) trimit motivul; aici devine un reper
   * vizual, nu o propozitie. Deschis din meniu, `premiumReason` e null si nu
   * se marcheaza nimic — nu exista un "implicit", fiindca n-a cerut nimic.
   */
  const highlightedPerk: string | null = premiumReason === null ? null : {
    cap: 'export',
    persons: 'persons',
    xmp: 'pro',
    contactSheet: 'pro',
    vault: 'pro',
    presentation: 'show',
    locations: 'locations'
  }[premiumReason];
  const photosUsed = useStore(s => s.photosUsedThisWindow);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(containerRef, open);
  /** null = inca nu stim (Play n-a raspuns, produs neconfigurat, web) — NU inventam un pret. */
  const [price, setPrice] = useState<string | null>(null);
  /**
   * Planurile chiar cumparabile ACUM, in ordinea in care le-a dat partea nativa
   * (lunar, apoi anual). Lista goala = acelasi lucru ca un pret absent: produse
   * neconfigurate in Play Console, sau build nesemnat.
   */
  const [plans, setPlans] = useState<PremiumPlan[]>([]);
  /** Ce plan e bifat. null pana vin planurile; apoi cel propus de defaultPlanId. */
  const [pickedPlanId, setPickedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Rezultatul ultimei restaurari: null = n-a cerut-o inca in sesiunea asta. */
  const [restored, setRestored] = useState<'none' | 'found' | null>(null);

  useEffect(() => {
    if (!open) { setFailed(false); setRestored(null); return; }
    let alive = true;
    void queryPremiumPrice().then(p => { if (alive) setPrice(p); });
    void queryPlansAnswer().then(({ plans: list }) => {
      if (!alive) return;
      setPlans(list);
      // Bifarea se reface la fiecare deschidere, nu se pastreaza intre ele: un
      // plan retras din Play Console sau o oferta expirata ar fi lasat butonul
      // legat de un id pe care partea nativa il respinge. Vezi si resolvePlan.
      setPickedPlanId(defaultPlanId(list));
    });
    // Reintrebam Play de fiecare data cand se deschide ecranul: intre timp
    // abonamentul poate fi expirat, anulat sau cumparat pe alt dispozitiv, iar
    // asta e exact ecranul pe care utilizatorul vine sa afle care e situatia.
    void refreshEntitlement();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  /**
   * Planul pe care apasa butonul. `resolvePlan` cade pe implicit daca id-ul
   * bifat nu mai e in lista — vezi core/premiumPlans.ts.
   */
  const picked = resolvePlan(plans, pickedPlanId);
  /**
   * Ce se reia dupa plata. Se citeste si cand omul e DEJA abonat si a lovit o
   * poarta ramasa dintr-o stare veche — atunci e tot calea corecta inainte.
   */
  const resume = premium ? resumeFor(premiumReason) : null;
  /** Reperul fata de care se citeste economia: primul plan, adica lunarul. */
  const referencePlan = plans[0] ?? null;

  if (!open) return null;

  return (
    <div className="detail" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        className="detail-inner narrow" ref={containerRef}
        role="dialog" aria-modal="true" aria-label={tr('premium.title')} tabIndex={-1}
      >
        <header className="detail-head">
          <span>{tr('premium.title')}</span>
          <button className="ghost icon-btn" onClick={() => setOpen(false)} aria-label={tr('detail.close')}>
            <XIcon />
          </button>
        </header>

        <span className="premium-chip">
          <StarIcon className="inline-icon" aria-hidden="true" /> {tr(premium ? 'premium.chip.active' : 'premium.chip')}
        </span>
        {/* PENTRU CE E BUN `premiumReason`, dupa doua incercari gresite.

            A doua a fost sa-l facem TITLU. Utilizatorul l-a respins, si a avut
            dreptate: "Ai vrut sa prezinti selectia" ii repeta inapoi ce tocmai
            apasase — nu-i spunea nimic ce nu stia deja. Iar ca sa faca asta,
            impinsese in gri mic singura fraza care chiar spune ceva ("Triajul
            ramane gratuit, Premium e pentru ce faci cu rezultatul").

            (Prima incercare fusese o caseta gri cu bara de accent, sub titlu,
            plus "Vine la pachet cu restul de mai jos" — respinsa ca inestetica
            si cu o a doua propozitie care nu spunea nimic.)

            Semnalul era bun, locul era gresit. Titlul ramane mereu propunerea
            de valoare, iar contextul se muta pe FUNCTIA in cauza, mai jos:
            randul ei e marcat, deci ochiul cade pe ea fara nicio propozitie in
            plus. Vezi highlightedPerk. */}
        <h3 className="premium-lead">{tr(premium ? 'premium.lead.active' : 'premium.lead')}</h3>
        {/* Randul de pret urmareste planul bifat, nu doar lunarul: altfel, cu
            anualul ales, scria in continuare "19,99 lei pe luna" deasupra unui
            buton care incaseaza 199,99 lei o data pe an. */}
        {!premium && (picked ?? price) && (
          <p className="premium-price">
            {picked
              ? tr(picked.periodDays > 31 ? 'premium.price.tagYear' : 'premium.price.tag', { price: picked.price })
              : tr('premium.price.tag', { price: price! })}
          </p>
        )}

        {/* Dovada inaintea cererii. Blocul se randeaza singur ca nimic atunci
            cand n-are destule date (sub doua sesiuni) — vezi LifetimeProof.
            Locul lui e SUS, imediat dupa pret: e singura parte din ecran care
            nu promite nimic, ci raporteaza ce s-a intamplat deja pe telefonul
            asta, si tocmai de-aia cantareste mai mult decat cele sapte
            beneficii de sub ea. */}
        <LifetimeProof locale={locale} premium={premium} />

        <h4 className="premium-group-head">{tr('premium.section.unlock')}</h4>

        <div className={highlightedPerk === 'export' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>
              {tr('premium.perk.export.title')}
              {highlightedPerk === 'export' && <i className="premium-wanted-tag">{tr('premium.wanted')}</i>}
            </b>
            <span>{tr('premium.perk.export.sub', { limit: FREE_PHOTOS_PER_MONTH })}</span>
          </span>
          <PremiumProof kind="export" />
        </div>
        <div className={highlightedPerk === 'persons' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>
              {tr('premium.perk.persons.title')}
              {highlightedPerk === 'persons' && <i className="premium-wanted-tag">{tr('premium.wanted')}</i>}
            </b>
            <span>{tr('premium.perk.persons.sub', { limit: FREE_ENROLLED_PERSONS })}</span>
          </span>
          <PremiumProof kind="persons" />
        </div>
        <div className={highlightedPerk === 'pro' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>
              {tr('premium.perk.pro.title')}
              {highlightedPerk === 'pro' && <i className="premium-wanted-tag">{tr('premium.wanted')}</i>}
            </b>
            <span>{tr('premium.perk.pro.sub')}</span>
          </span>
          <PremiumProof kind="pro" />
        </div>
        <div className={highlightedPerk === 'show' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>
              {tr('premium.perk.show.title')}
              {highlightedPerk === 'show' && <i className="premium-wanted-tag">{tr('premium.wanted')}</i>}
            </b>
            <span>{tr('premium.perk.show.sub')}</span>
          </span>
          <PremiumProof kind="show" />
        </div>
        {/* Rand propriu, nu o vorba in subtitlul de mai sus: era pomenit acolo
            printre altele si utilizatorul, care CHIAR are ecranul blocat, n-a
            observat ca plateste pentru el. */}
        <div className={highlightedPerk === 'locations' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>
              {tr('premium.perk.locations.title')}
              {highlightedPerk === 'locations' && <i className="premium-wanted-tag">{tr('premium.wanted')}</i>}
            </b>
            <span>{tr('premium.perk.locations.sub')}</span>
          </span>
          <PremiumProof kind="locations" />
        </div>
        {/* Ultimul, deliberat: e singurul lucru din lista pe care nu-l are
            nimeni altcineva, si se retine mai bine la final decat la mijloc. */}
        <div className={highlightedPerk === 'composite' ? 'premium-perk premium-perk-demo is-wanted' : 'premium-perk premium-perk-demo'}>
          <span>
            <b>{tr('premium.perk.composite.title')}</b>
            <span>{tr('premium.perk.composite.sub')}</span>
          </span>
          <PremiumProof kind="composite" />
        </div>

        {/* Un abonat nu are de ce sa vada cat i-a mai ramas dintr-un plafon pe
            care nu-l mai are — vezi remainingFreePhotos(), care intoarce Infinity. */}
        <section className="premium-group premium-free">
          <h4 className="premium-group-head">{tr('premium.section.free')}</h4>
          <div className="premium-perk">
            <i aria-hidden="true"><CheckIcon /></i>
            <span>
              <b>{tr('premium.perk.local.title')}</b>
              <span>{tr('premium.perk.local.sub')}</span>
            </span>
          </div>
        </section>

        <div className="premium-usage">
          {premium ? (
            <b>{tr('premium.usage.titlePremium', { count: photosUsed })}</b>
          ) : (
            <>
              <span className="premium-usage-label mono">{tr('premium.usage.label')}</span>
              <b>{tr('premium.usage.title', { count: photosUsed, limit: FREE_PHOTOS_PER_MONTH })}</b>
              {/* Bara e doar vizuala: cifrele exacte sunt deja in randul de
                  deasupra, iar o bara cu rol de progressbar intr-un card pe
                  care nimeni nu-l parcurge cu tastatura n-ar fi citita oricum. */}
              <span className="premium-usage-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.round((photosUsed / FREE_PHOTOS_PER_MONTH) * 100))}%` }} />
              </span>
              {/* "2 din 1 persoane inrolate" — raportat de utilizator dupa ce a
                  iesit din abonament. Plafonul isi face treaba (nu se mai poate
                  adauga nimeni, vezi canEnrollAnotherPersonFree), iar profilurile
                  facute deja raman ale lui cu buna stiinta: un abonament expirat
                  n-are voie sa ia ostatica munca omului, acelasi principiu ca la
                  dosarul privat. Doar propozitia era imposibila. */}
              <span>{persons.length > FREE_ENROLLED_PERSONS
                ? tr('premium.usage.persons.over', { count: persons.length, limit: FREE_ENROLLED_PERSONS })
                : tr('premium.usage.persons', { count: persons.length, limit: FREE_ENROLLED_PERSONS })}</span>
            </>
          )}
        </div>

        {premium ? (
          /* Starea care lipsea complet: confirmare, si de unde se gestioneaza
             abonamentul. Anularea se face DOAR din Google Play — asa cere Play,
             si oricum aplicatia n-are cum s-o faca in locul lui. */
          <>
            {/* CALEA INAPOI, si e bugul cel mai scump din ecranul asta: cine
                lovea o poarta, platea, si primea confirmarea... si atat. Functia
                pentru care tocmai platise nu pornea; trebuia sa inchida ecranul
                si s-o caute din nou in meniu. Vezi ui/premiumResume.ts. */}
            {resume && (
              <button
                className="btn-accent big premium-resume"
                onClick={() => { setOpen(false); resume.run(useStore.getState()); }}
              >
                {tr(resume.labelKey)}
              </button>
            )}
            <p className="premium-soon" role="status">{tr('premium.manage')}</p>
          </>
        ) : isBillingAvailable() && (picked ?? price) ? (
          /* Butonul apare doar cand Play chiar a confirmat ca exista ceva de
             cumparat: un plan (sau, ca rezerva, un pret) inseamna produs
             configurat SI build semnat. Un buton care deschide un flux
             inexistent e mai rau decat un anunt. */
          <>
            {/* Alegerea planului, chiar deasupra butonului — acolo se ia
                decizia. Cu un singur plan configurat in Play Console nu se
                afiseaza nimic aici: doua carduri din care unul e singura optiune
                nu e o alegere, e un pas in plus. */}
            {plans.length > 1 && (
              <fieldset className="premium-plans">
                <legend className="premium-group-head">{tr('premium.plans.title')}</legend>
                {plans.map(plan => {
                  const isPicked = plan.id === picked?.id;
                  // Economia se raporteaza mereu la PRIMUL plan (lunarul), si
                  // niciodata la el insusi — vezi core/premiumPlans.ts.
                  const savings = referencePlan && referencePlan.id !== plan.id
                    ? annualSavingsPercent(referencePlan, plan) : null;
                  const monthly = perMonthPrice(plan, locale);
                  return (
                    <label key={plan.id} className={isPicked ? 'premium-plan is-picked' : 'premium-plan'}>
                      <input
                        type="radio" name="premium-plan" value={plan.id} checked={isPicked}
                        onChange={() => setPickedPlanId(plan.id)}
                      />
                      <span className="premium-plan-body">
                        <b>
                          {tr(plan.periodDays > 31 ? 'premium.plan.yearly' : 'premium.plan.monthly')}
                          {savings !== null && (
                            <i className="premium-plan-save" title={tr('premium.plan.saveTitle', { percent: savings })}>
                              {tr('premium.plan.save', { percent: savings })}
                            </i>
                          )}
                        </b>
                        <span className="premium-plan-price">{plan.price}</span>
                        {/* Doar cifrele primite de la Play: pretul pe luna e
                            derivat din priceMicros si formatat cu Intl in moneda
                            contului, nu taiat din textul de mai sus. */}
                        {monthly && <span className="premium-plan-permonth mono">{tr('premium.plan.perMonth', { price: monthly })}</span>}
                        {plan.trialDays && (
                          <span className="premium-plan-trial">
                            {tr(plural(plan.trialDays, 'premium.plan.trial.one', 'premium.plan.trial.other'), { count: plan.trialDays })}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <button
              className="btn-accent big premium-subscribe"
              disabled={busy}
              onClick={() => {
                setBusy(true); setFailed(false);
                void startSubscription(picked?.id)
                  .then(async outcome => {
                    // NU mai inchidem ecranul la cumparare reusita: refreshEntitlement()
                    // comuta starea, iar utilizatorul ramane exact aici si VEDE
                    // confirmarea. Inainte ecranul disparea fara niciun cuvant,
                    // adica singura confirmare a unei plati era absenta ei.
                    if (outcome === 'purchased') await refreshEntitlement();
                    else if (outcome === 'unavailable') setFailed(true);
                    // 'cancelled' = utilizatorul s-a razgandit; nimic de spus
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy
                ? tr('premium.subscribing')
                : picked?.trialDays
                  ? tr('premium.subscribe.trial', { price: picked.price })
                  : tr('premium.subscribe', { price: picked?.price ?? price! })}
            </button>
            {/* CONDITIILE, sub buton, inainte de plata.

                Nu e o formalitate juridica pusa ca sa fie: Play cere explicit ca
                pretul, perioada de facturare si faptul ca abonamentul SE
                REINNOIESTE SINGUR sa fie vizibile inainte de cumparare, iar cand
                exista o perioada de proba, sa scrie limpede ca ea se transforma
                in plata si cu cat. E unul dintre motivele obisnuite de respingere
                la review pentru aplicatiile cu abonament — si, indiferent de
                Play, un utilizator care afla abia din extrasul de cont ca s-a
                reinnoit e un utilizator pierdut, plus o recenzie de o stea.

                Textul urmareste planul BIFAT, deci spune mereu cifra pe care
                chiar o va incasa butonul de deasupra. */}
            {picked && (
              <p className="premium-terms">
                {picked.trialDays
                  ? tr(plural(picked.trialDays, 'premium.renewal.trial.one', 'premium.renewal.trial.other'),
                      { count: picked.trialDays, price: picked.price })
                  : tr(picked.periodDays > 31 ? 'premium.renewal.yearly' : 'premium.renewal.monthly',
                      { price: picked.price })}
              </p>
            )}
            {failed && <p className="premium-soon" role="alert">{tr('premium.failed')}</p>}
            {/* Cerinta Google Play pentru orice aplicatie cu abonamente, si o
                nevoie reala: dupa reinstalare sau pe un telefon nou, contul are
                abonamentul, dar cache-ul local (vezi entitlement.ts) e gol. Fara
                butonul asta, singura solutie era sa astepte o pornire cu retea. */}
            <button
              className="ghost premium-restore"
              disabled={busy}
              onClick={() => {
                setBusy(true); setRestored(null);
                void refreshEntitlement()
                  .then(active => setRestored(active ? 'found' : 'none'))
                  .finally(() => setBusy(false));
              }}
            >
              {tr('premium.restore')}
            </button>
            {restored === 'none' && <p className="premium-soon" role="status">{tr('premium.restore.none')}</p>}
          </>
        ) : (
          <p className="premium-soon">{tr('premium.soon')}</p>
        )}
      </div>
    </div>
  );
}
