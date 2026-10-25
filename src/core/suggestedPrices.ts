/**
 * core/suggestedPrices.ts
 * Prețurile pe care le creăm în Play Console. NU sunt prețul afișat.
 *
 * Ecranul Premium arată doar cifra pe care o întoarce Play, în moneda
 * contului. O cifră scrisă aici și pusă pe ecran ar minți în ziua în care
 * Play Console are alt preț, sau în altă țară. Lista de mai jos e pentru
 * omul care creează produsele, și pentru README.
 *
 * Nu există plan săptămânal, intenționat. În categoria asta abonamentul
 * săptămânal e reclamația de încredere („greu de anulat”, „pretinde că e
 * gratuit”). Anualul are perioada de probă de 7 zile, configurată ca ofertă
 * pe planul de bază, nu ca un al patrulea produs.
 */

export const MONTHLY_PRODUCT_ID = 'lumin_premium_monthly';
export const YEARLY_PRODUCT_ID = 'lumin_premium_yearly';
export const LIFETIME_PRODUCT_ID = 'lumin_premium_lifetime';

/** Ordinea în care le creăm și le arătăm: lunarul e reperul, anualul e implicit, lifetime e ancora. */
export const PRODUCT_IDS = [MONTHLY_PRODUCT_ID, YEARLY_PRODUCT_ID, LIFETIME_PRODUCT_ID] as const;

export const YEARLY_TRIAL_DAYS = 7;

/**
 * Prețuri sugerate, de testat, nu definitive. Pentru celelalte țări se folosesc
 * șabloanele Play Console, rotunjite local. Anualul e mult sub 12× lunarul
 * (înainte era ~10×, adică o reducere de ~17%, prea mică ca să conteze).
 */
export const SUGGESTED_PRICES = {
  // Anualul e planul de pus în față: sub o lună din abonamentele săptămânale
  // ale categoriei. Lifetime e cam 1,7× anualul, ca să fie o ieșire din
  // abonament, nu un al doilea abonament. Lunarul rămâne reperul.
  yearly: { productId: YEARLY_PRODUCT_ID, usd: 19.99, ron: 79.99, trialDays: YEARLY_TRIAL_DAYS },
  monthly: { productId: MONTHLY_PRODUCT_ID, usd: 4.99, ron: 19.99 },
  lifetime: { productId: LIFETIME_PRODUCT_ID, usd: 34.99, ron: 139.99 }
} as const;

/** Adevărat cât timp lista de produse nu conține un plan săptămânal. */
export function hasNoWeeklyPlan(ids: readonly string[] = PRODUCT_IDS): boolean {
  return ids.every(id => !/week/i.test(id));
}
