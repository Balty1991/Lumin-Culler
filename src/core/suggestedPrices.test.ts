import { describe, expect, it } from 'vitest';
import {
  LIFETIME_PRODUCT_ID, MONTHLY_PRODUCT_ID, PRODUCT_IDS, SUGGESTED_PRICES,
  YEARLY_PRODUCT_ID, YEARLY_TRIAL_DAYS, hasNoWeeklyPlan
} from './suggestedPrices';

describe('produsele Premium', () => {
  it('are exact trei produse: lunar, anual cu 7 zile, lifetime', () => {
    expect(PRODUCT_IDS).toEqual([MONTHLY_PRODUCT_ID, YEARLY_PRODUCT_ID, LIFETIME_PRODUCT_ID]);
    expect(SUGGESTED_PRICES.yearly.trialDays).toBe(YEARLY_TRIAL_DAYS);
    expect(SUGGESTED_PRICES.yearly.trialDays).toBe(7);
    expect(SUGGESTED_PRICES.monthly).not.toHaveProperty('trialDays');
  });

  it('nu are plan săptămânal', () => {
    expect(hasNoWeeklyPlan()).toBe(true);
    expect(hasNoWeeklyPlan(['lumin_premium_weekly'])).toBe(false);
  });

  it('anualul sugerat e la jumătate sau sub doisprezece luni', () => {
    // 29,99 față de 12×4,99 (59,88) e 50%, rotunjirea de un cent rămâne jumătate.
    expect(SUGGESTED_PRICES.yearly.usd).toBeLessThanOrEqual(SUGGESTED_PRICES.monthly.usd * 6 + 0.05);
    expect(SUGGESTED_PRICES.yearly.ron).toBeLessThanOrEqual(SUGGESTED_PRICES.monthly.ron * 6 + 0.05);
  });
});
