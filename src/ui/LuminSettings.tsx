import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';
import { LocaleToggle } from './LocaleToggle';
import {
  readAutoClean, reminderDaysOf, writeAutoClean, type AutoCleanSettings, type ReminderDays
} from '../core/autoClean';
import { markCleanReminderShown, scheduleCleanReminder } from '../core/cleanReminder';
import { requestNotificationAccess, showNotification } from '../core/nativeNotifications';
import { formatSize } from '../state/storageStats';

/**
 * Al treilea tab. Nu e sertarul vechi: limba, mementoul, Premium și poarta
 * spre uneltele Pro. Sertarele rămân în spatele „Toate uneltele”.
 */
export function LuminSettings() {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const premiumLocked = useStore(s => s.premiumLocked);
  const proMode = useStore(s => s.proMode);
  const setProMode = useStore(s => s.setProMode);
  const gatePremium = useStore(s => s.gatePremium);
  const setPremiumOpen = useStore(s => s.setPremiumOpen);
  const setMenuOpen = useStore(s => s.setMenuOpen);
  const [auto, setAuto] = useState<AutoCleanSettings>(() => readAutoClean());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setAuto(readAutoClean());
    window.addEventListener('lumin-auto-clean', sync);
    return () => window.removeEventListener('lumin-auto-clean', sync);
  }, []);

  const publish = (next: AutoCleanSettings) => {
    writeAutoClean(next);
    setAuto(next);
    window.dispatchEvent(new Event('lumin-auto-clean'));
  };

  const setFlag = (key: 'monthlyReminder' | 'expireScreenshots', value: boolean) => {
    if (value && premiumLocked) {
      gatePremium('autoClean');
      setNotice(tr('clean.auto.locked'));
      return;
    }
    const next = { ...auto, [key]: value };
    if (key === 'monthlyReminder' && value) {
      next.lastMonthlyReminderAt = Date.now();
      void requestNotificationAccess();
      const bytes = readReclaimable();
      const body = bytes > 0
        ? tr('clean.reminder.body', { size: formatSize(bytes) })
        : tr('clean.reminder.empty');
      void showNotification({ title: 'Lumin', body, channelName: 'Lumin' });
      void markCleanReminderShown();
      void scheduleCleanReminder({ intervalDays: next.reminderDays, locale, reclaimableBytes: bytes, reset: true });
    }
    if (key === 'monthlyReminder' && !value) {
      void import('../core/cleanReminder').then(mod => mod.cancelCleanReminder());
    }
    publish(next);
  };

  const setDays = (days: ReminderDays) => {
    if (premiumLocked) {
      gatePremium('autoClean');
      setNotice(tr('clean.auto.locked'));
      return;
    }
    publish({ ...auto, reminderDays: days });
  };

  return (
    <section className="orbit-settings" aria-label={tr('settings.title')}>
      <header className="orbit-settings-head">
        <p className="orbit-kicker">LUMIN</p>
        <h2>{tr('settings.title')}</h2>
        <p>{tr('settings.lead')}</p>
      </header>

      <div className="orbit-setting">
        <span>{tr('menu.language')}</span>
        <LocaleToggle />
      </div>

      <button type="button" className="orbit-setting orbit-setting-btn" onClick={() => setPremiumOpen(true)}>
        <span>
          <strong>{tr('settings.premium')}</strong>
          <small>{tr('premium.lead')}</small>
        </span>
      </button>

      <label className="orbit-setting">
        <span>
          <strong>{tr('settings.pro')}</strong>
          <small>{tr('settings.pro.sub')}</small>
        </span>
        <input type="checkbox" checked={proMode} onChange={event => setProMode(event.target.checked)} />
      </label>

      <section className="orbit-setting orbit-setting-stack" aria-label={tr('clean.auto.title')}>
        <h3>{tr('clean.auto.title')}</h3>
        <label>
          <input type="checkbox" checked={auto.monthlyReminder} onChange={event => setFlag('monthlyReminder', event.target.checked)} />
          <span><strong>{tr('clean.auto.monthly')}</strong><small>{tr('clean.auto.monthly.sub')}</small></span>
        </label>
        <label className="clean-reminder-days">
          <span>{tr('clean.reminder.days')}</span>
          <select
            value={auto.reminderDays}
            aria-label={tr('clean.reminder.days')}
            onChange={event => setDays(reminderDaysOf(Number(event.target.value)))}
          >
            <option value={7}>{tr('clean.reminder.7')}</option>
            <option value={14}>{tr('clean.reminder.14')}</option>
            <option value={30}>{tr('clean.reminder.30')}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={auto.expireScreenshots} onChange={event => setFlag('expireScreenshots', event.target.checked)} />
          <span><strong>{tr('clean.auto.screenshots')}</strong><small>{tr('clean.auto.screenshots.sub')}</small></span>
        </label>
        {notice && <p role="status">{notice}</p>}
      </section>

      <button type="button" className="orbit-setting orbit-setting-btn" onClick={() => setMenuOpen(true)}>
        <span><strong>{tr('settings.tools')}</strong></span>
      </button>
    </section>
  );
}

function readReclaimable(): number {
  try {
    const n = Number(sessionStorage.getItem('lumin-reclaimable'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
