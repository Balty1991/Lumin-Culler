import { beforeEach, describe, expect, it } from 'vitest';
import { autonomyOfferFor, readOfferSnooze, snoozeOffer, SNOOZE_DAYS, type OfferInput } from './autonomyOffer';

const now = new Date(2026, 10, 27).getTime();
const base: OfferInput = { percent: 87, decisions: 40, safe: true, autonomy: 'suggest', snoozedUntil: null, now };

describe('autonomia câștigată', () => {
  beforeEach(() => localStorage.clear());

  it('propune pasul următor: sugerează → sigurele → tot (Pro)', () => {
    expect(autonomyOfferFor(base)).toEqual({ from: 'suggest', to: 'sure', percent: 87, pro: false });
    expect(autonomyOfferFor({ ...base, autonomy: 'sure' })).toEqual({ from: 'sure', to: 'all', percent: 87, pro: true });
  });

  it('niciodată peste „tot”', () => {
    expect(autonomyOfferFor({ ...base, autonomy: 'all', percent: 99 })).toBeNull();
  });

  it('cere procent mare, destule decizii și siguranță', () => {
    expect(autonomyOfferFor({ ...base, percent: 84 })).toBeNull();
    expect(autonomyOfferFor({ ...base, percent: 85 })).not.toBeNull();
    expect(autonomyOfferFor({ ...base, percent: null })).toBeNull();
    expect(autonomyOfferFor({ ...base, decisions: 29 })).toBeNull();
    expect(autonomyOfferFor({ ...base, decisions: 30 })).not.toBeNull();
    expect(autonomyOfferFor({ ...base, safe: false })).toBeNull();
  });

  it('„Mai târziu” ascunde cardul 7 zile, apoi revine', () => {
    snoozeOffer(now);
    const until = readOfferSnooze();
    expect(until).toBe(now + SNOOZE_DAYS * 86_400_000);
    expect(autonomyOfferFor({ ...base, snoozedUntil: until })).toBeNull();
    expect(autonomyOfferFor({ ...base, snoozedUntil: until, now: now + 6 * 86_400_000 })).toBeNull();
    expect(autonomyOfferFor({ ...base, snoozedUntil: until, now: now + 7 * 86_400_000 })).not.toBeNull();
  });

  it('fără amânare salvată: null', () => {
    expect(readOfferSnooze()).toBeNull();
  });
});
