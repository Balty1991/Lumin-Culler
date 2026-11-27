import { describe, it, expect } from 'vitest';
import { ensureLocaleLoaded, t } from '../i18n';
import { composeDailyAssistant, dailyAssistantCounts, localDayKey, type AssistantPhoto } from './dailyAssistant';

const now = new Date(2026, 10, 27, 20, 30).getTime();
const today = new Date(2026, 10, 27, 10).getTime();
const yesterday = new Date(2026, 10, 26, 10).getTime();
const ro = (key: string, params?: Record<string, string | number>) => t('ro', key, params);

function photos(sure: number, ask: number, extra: AssistantPhoto[] = []): AssistantPhoto[] {
  return [
    ...Array.from({ length: sure }, (_, i) => ({ capturedAt: today, importedAt: today, status: i % 2 ? 'rejected' : 'selected', aiDecided: true })),
    ...Array.from({ length: ask }, () => ({ capturedAt: today, importedAt: today, status: 'review', aiDecided: true })),
    ...extra
  ];
}

describe('dailyAssistantCounts', () => {
  it('numără doar ziua de azi și doar ce a hotărât sau a lăsat AI-ul', () => {
    const c = dailyAssistantCounts(photos(3, 2, [
      { capturedAt: yesterday, importedAt: today, status: 'selected', aiDecided: true },
      { capturedAt: today, importedAt: today, status: 'selected', aiDecided: false },
      { capturedAt: today, importedAt: today, status: 'selected' },
      { capturedAt: today, importedAt: today, status: 'pending' },
      { capturedAt: today, importedAt: today, status: 'review', aside: 'screenshot' },
      { importedAt: today, status: 'review' }
    ]), now);
    expect(c).toEqual({ sorted: 6, sure: 3, ask: 3, known: 10 });
  });
});

describe('composeDailyAssistant', () => {
  const msg = (sure: number, ask: number) => composeDailyAssistant(dailyAssistantCounts(photos(sure, ask), now), ro);

  it('vorbește ca tine, cu pluralul românesc corect', () => {
    expect(msg(19, 4)).toEqual({
      title: 'Azi am sortat 23 de poze ca tine',
      body: 'Pe 19 sunt sigur — te întreb doar de 4.',
      action: 'review_today'
    });
    expect(msg(2, 1)?.title).toBe('Azi am sortat 3 poze ca tine');
    expect(msg(2, 1)?.body).toBe('Pe 2 sunt sigur — te întreb doar de una.');
    expect(msg(1, 4)?.body).toBe('Pe una sunt sigur — te întreb de celelalte 4.');
    expect(msg(0, 5)?.body).toBe('Încă nu sunt sigur pe niciuna — te întreb de toate 5.');
  });

  it('când totul e sigur, nu cere nimic și deschide doar ziua', () => {
    expect(msg(12, 0)).toEqual({ title: 'Azi am sortat 12 poze ca tine', body: 'N-ai nimic de verificat.', action: 'today' });
  });

  it('fără nimic nou, nicio notificare', () => {
    expect(msg(0, 0)).toBeNull();
    expect(msg(2, 0)).toBeNull();
    expect(composeDailyAssistant(dailyAssistantCounts(photos(0, 0, [{ capturedAt: yesterday, importedAt: yesterday, status: 'selected', aiDecided: true }]), now), ro)).toBeNull();
  });

  it('are text în toate limbile, fără acolade rămase', async () => {
    for (const locale of ['ro', 'en', 'de', 'fr', 'es', 'it'] as const) {
      await ensureLocaleLoaded(locale);
      for (const [sure, ask] of [[19, 4], [2, 1], [1, 4], [0, 5], [12, 0]]) {
        const m = composeDailyAssistant(dailyAssistantCounts(photos(sure, ask), now), (k, p) => t(locale, k, p));
        expect(m).not.toBeNull();
        expect(`${m!.title} ${m!.body}`).not.toMatch(/[{}]|lx\.assistant/);
      }
    }
    expect(composeDailyAssistant(dailyAssistantCounts(photos(19, 4), now), (k, p) => t('de', k, p))?.body).toBe('Bei 19 bin ich mir sicher – ich frage dich nur bei 4.');
  });
});

describe('localDayKey', () => {
  it('dă ziua locală, ca receptorul nativ', () => {
    expect(localDayKey(now)).toBe('2026-11-27');
    expect(localDayKey(new Date(2026, 0, 5, 0, 1).getTime())).toBe('2026-01-05');
  });
});
