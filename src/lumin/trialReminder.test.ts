import { describe, expect, it } from 'vitest';
import { scheduleTrialReminder, trialReminderTime } from './trialReminder';
import type { PaywallLogEntry } from './paywallMoment';

const DAY = 86_400_000;
const start = new Date(2026, 10, 18, 21, 30).getTime();
const log: PaywallLogEntry[] = [{ at: start, event: 'trial_started', source: 'lumin_premium_yearly' }];
const text = { title: 't', body: 'b' };

describe('memento-ul de sfârșit de probă', () => {
  it('sună cu două zile înainte de final, la 10 dimineața', () => {
    const at = new Date(trialReminderTime(start));
    expect(at.getDate()).toBe(23);
    expect(at.getHours()).toBe(10);
    expect(at.getMinutes()).toBe(0);
  });

  it('se programează cât proba încă nu a ajuns la memento', () => {
    expect(scheduleTrialReminder(text, start + DAY, log)).toBe(trialReminderTime(start));
  });

  it('nu se mai programează după ora memento-ului', () => {
    expect(scheduleTrialReminder(text, start + 6 * DAY, log)).toBeNull();
  });

  it('fără probă pornită, nimic', () => {
    expect(scheduleTrialReminder(text, start, [])).toBeNull();
  });
});
