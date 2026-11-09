import { beforeEach, describe, expect, it } from 'vitest';
import { claimPaywall, logPaywall, purchaseEvent, readPaywallLog, resetPaywallSession } from './paywallMoment';

describe('paywall contextual', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPaywallSession();
  });

  it('permite o singură ofertă pe zi și pe sesiune', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(claimPaywall(now)).toBe(true);
    expect(claimPaywall(now + 1000)).toBe(false);
    resetPaywallSession();
    expect(claimPaywall(now + 2000)).toBe(false);
    expect(claimPaywall(now + 26 * 60 * 60 * 1000)).toBe(true);
  });

  it('jurnalul rămâne pe telefon și recunoaște doar produsele reale', () => {
    logPaywall('paywall_shown', 'cleanup_done', 1);
    logPaywall('paywall_dismissed', 'cleanup_done', 2);
    expect(readPaywallLog().map(e => e.event)).toEqual(['paywall_dismissed', 'paywall_shown']);
    expect(purchaseEvent('lumin_premium_yearly')).toBe('purchase_yearly');
    expect(purchaseEvent('lumin_premium_monthly')).toBe('purchase_monthly');
    expect(purchaseEvent('cherrypic_pro_forever')).toBe('purchase_lifetime');
    expect(purchaseEvent('weekly')).toBeNull();
  });
});
