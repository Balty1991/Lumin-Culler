import { useEffect, useState } from 'react';
import {
  isBillingAvailable,
  queryPlansAnswer,
  queryPremiumStatusAnswer,
  startSubscription,
  type PlansAnswer,
  type PremiumPlan
} from '../../core/billing';
import { readAutoClean, writeAutoClean, type ReminderDays } from '../../core/autoClean';
import { cancelCleanReminder, scheduleCleanReminder } from '../../core/cleanReminder';
import { openStoreListing } from '../../core/storeListing';
import { rescueT, type RescueKey, type RescueLocale } from '../../rescue/copy';
import { BackButton } from './chrome';

export default function SettingsScreens(props: {
  screen: 'settings' | 'paywall';
  locale: RescueLocale;
  reclaimable: number;
  onBack: () => void;
  onOpen: (screen: 'settings' | 'paywall') => void;
  onLocale: (locale: RescueLocale) => void;
}) {
  if (props.screen === 'settings') {
    return (
      <Settings
        locale={props.locale}
        reclaimable={props.reclaimable}
        onLocale={props.onLocale}
        onOpen={props.onOpen}
      />
    );
  }
  return <Paywall locale={props.locale} onBack={props.onBack} onOpen={props.onOpen} />;
}

function Settings(props: {
  locale: RescueLocale;
  reclaimable: number;
  onLocale: (locale: RescueLocale) => void;
  onOpen: (screen: 'paywall') => void;
}) {
  const { locale } = props;
  const [settings, setSettings] = useState(readAutoClean);
  const [note, setNote] = useState<string | null>(null);

  const saveReminder = (monthlyReminder: boolean, reminderDays: ReminderDays) => {
    const next = { ...settings, monthlyReminder, reminderDays };
    setSettings(next);
    writeAutoClean(next);
    if (monthlyReminder) {
      void scheduleCleanReminder({
        intervalDays: reminderDays,
        locale,
        reclaimableBytes: props.reclaimable,
        reset: reminderDays !== settings.reminderDays
      });
    } else {
      void cancelCleanReminder();
    }
  };

  const restore = async () => {
    if (!isBillingAvailable()) {
      setNote(rescueT(locale, 'restoreWeb'));
      return;
    }
    const answer = await queryPremiumStatusAnswer();
    if (!answer.answered) {
      setNote(rescueT(locale, 'restoreMiss'));
      return;
    }
    setNote(rescueT(locale, answer.active ? 'restored' : 'restoreNone'));
  };

  return (
    <>
      <h1>{rescueT(locale, 'settingsTitle')}</h1>
      <section className="rescue-card">
        <h2>{rescueT(locale, 'language')}</h2>
        <div className="rescue-segment" role="group" aria-label={rescueT(locale, 'language')}>
          <button type="button" aria-pressed={locale === 'ro'} onClick={() => props.onLocale('ro')}>Română</button>
          <button type="button" aria-pressed={locale === 'en'} onClick={() => props.onLocale('en')}>English</button>
        </div>
      </section>
      <section className="rescue-card">
        <div className="rescue-setting">
          <div>
            <h2>{rescueT(locale, 'reminder')}</h2>
            <p className="rescue-muted">{rescueT(locale, 'reminderBody')}</p>
          </div>
          <button
            type="button"
            className="rescue-switch"
            role="switch"
            aria-checked={settings.monthlyReminder}
            aria-label={rescueT(locale, 'reminder')}
            onClick={() => saveReminder(!settings.monthlyReminder, settings.reminderDays)}
          >
            <span className="rescue-switch-track" aria-hidden="true"><span className="rescue-switch-thumb" /></span>
          </button>
        </div>
        {settings.monthlyReminder ? (
          <label className="rescue-stack">
            <span>{rescueT(locale, 'daysLabel')}</span>
            <select
              className="rescue-select"
              value={settings.reminderDays}
              onChange={event => saveReminder(true, Number(event.target.value) as ReminderDays)}
            >
              <option value={7}>{rescueT(locale, 'days7')}</option>
              <option value={14}>{rescueT(locale, 'days14')}</option>
              <option value={30}>{rescueT(locale, 'days30')}</option>
            </select>
          </label>
        ) : null}
      </section>
      <section className="rescue-card">
        <h2>{rescueT(locale, 'premium')}</h2>
        <p className="rescue-muted">{rescueT(locale, 'premiumBody')}</p>
        <button type="button" className="rescue-btn" onClick={() => props.onOpen('paywall')}>{rescueT(locale, 'premium')}</button>
        <button type="button" className="rescue-btn quiet" onClick={() => void restore()}>{rescueT(locale, 'restore')}</button>
        {note ? <p className="rescue-muted">{note}</p> : null}
      </section>
      <section className="rescue-card">
        <h2>{rescueT(locale, 'privacyLink')}</h2>
        <p>{rescueT(locale, 'privacy')}</p>
        <a href="privacy-policy.html">{rescueT(locale, 'privacyLink')}</a>
      </section>
    </>
  );
}

const PLAN_ORDER: Record<PremiumPlan['kind'], number> = { yearly: 0, lifetime: 1, monthly: 2 };
const PLAN_NAME: Record<PremiumPlan['kind'], RescueKey> = {
  yearly: 'planYearly',
  lifetime: 'planLifetime',
  monthly: 'planMonthly'
};

function Paywall(props: {
  locale: RescueLocale;
  onBack: () => void;
  onOpen: (screen: 'settings') => void;
}) {
  const { locale } = props;
  const billing = isBillingAvailable();
  const [plans, setPlans] = useState<PlansAnswer | null>(billing ? null : { answered: false, plans: [] });
  const [premium, setPremium] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!billing) return;
    let live = true;
    void queryPlansAnswer().then(answer => { if (live) setPlans(answer); });
    void queryPremiumStatusAnswer().then(answer => { if (live && answer.answered) setPremium(answer.active); });
    return () => { live = false; };
  }, [billing]);

  const restore = async () => {
    if (!billing) {
      setNote(rescueT(locale, 'restoreWeb'));
      return;
    }
    const answer = await queryPremiumStatusAnswer();
    if (!answer.answered) {
      setNote(rescueT(locale, 'restoreMiss'));
      return;
    }
    setPremium(answer.active);
    setNote(rescueT(locale, answer.active ? 'restored' : 'restoreNone'));
  };

  const ordered = [...(plans?.plans ?? [])].sort((a, b) => PLAN_ORDER[a.kind] - PLAN_ORDER[b.kind]);

  return (
    <>
      <BackButton label={rescueT(locale, 'back')} onClick={props.onBack} />
      <h1>{rescueT(locale, 'payTitle')}</h1>
      <p>{rescueT(locale, 'payBody')}</p>
      {premium ? <p>{rescueT(locale, 'payOwned')}</p> : null}
      {!premium && plans === null ? <p className="rescue-muted">{rescueT(locale, 'payConnecting')}</p> : null}
      {!premium && plans?.answered && ordered.length === 0 ? <p>{rescueT(locale, 'payEmpty')}</p> : null}
      {!premium && ordered.map(plan => (
        <section className="rescue-card" key={plan.id}>
          {plan.kind === 'yearly' ? <span className="rescue-pill">{rescueT(locale, 'payBest')}</span> : null}
          <h2>{rescueT(locale, PLAN_NAME[plan.kind])}</h2>
          {plan.trialDays ? <p className="rescue-muted">{rescueT(locale, 'payTrial', { count: plan.trialDays, price: plan.price })}</p> : null}
          {plan.kind === 'lifetime' ? <p className="rescue-muted">{rescueT(locale, 'payOnce')}</p> : null}
          <button type="button" className="rescue-btn" onClick={() => void startSubscription(plan.id).then(outcome => { if (outcome === 'purchased') setPremium(true); })}>
            {rescueT(locale, 'payPrice', { name: rescueT(locale, PLAN_NAME[plan.kind]), price: plan.price })}
          </button>
        </section>
      ))}
      {!premium && !billing ? (
        <div className="rescue-stack">
          <section className="rescue-card"><h2>{rescueT(locale, 'planYearly')}</h2><p className="rescue-muted">{rescueT(locale, 'payYearly')}</p></section>
          <section className="rescue-card"><h2>{rescueT(locale, 'planLifetime')}</h2><p className="rescue-muted">{rescueT(locale, 'payLifetime')}</p></section>
          <section className="rescue-card"><h2>{rescueT(locale, 'planMonthly')}</h2><p className="rescue-muted">{rescueT(locale, 'payMonthly')}</p></section>
          <p className="rescue-muted">{rescueT(locale, 'payWeb')}</p>
          <p className="rescue-muted">{rescueT(locale, 'payNoWeekly')}</p>
          <button type="button" className="rescue-btn" onClick={() => openStoreListing()}>{rescueT(locale, 'payPlay')}</button>
        </div>
      ) : null}
      <button type="button" className="rescue-btn quiet" onClick={() => void restore()}>{rescueT(locale, 'restore')}</button>
      {note ? <p className="rescue-muted">{note}</p> : null}
      <button type="button" className="rescue-btn text" onClick={() => props.onOpen('settings')}>{rescueT(locale, 'payNotNow')}</button>
    </>
  );
}
