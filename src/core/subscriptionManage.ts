/**
 * core/subscriptionManage.ts
 * Unde se anulează, spus pe față.
 *
 * Play nu lasă aplicația să anuleze un abonament în locul omului, și nici nu
 * vrem s-o ascundem după trei ecrane. Butonul deschide pagina de abonamente
 * a contului, filtrată pe aplicația asta. Achiziția lifetime nu se reînnoiește;
 * același link rămâne valabil pentru planul lunar sau anual, dacă există.
 */

export const APP_ID = 'com.luminculler.app';

/** Pagina de abonamente Play, pe pachetul aplicației. */
export const SUBSCRIPTION_MANAGE_URL =
  `https://play.google.com/store/account/subscriptions?package=${APP_ID}`;

export function openSubscriptionManagement(
  open: (url: string) => Window | null = url => window.open(url, '_blank', 'noopener')
): string {
  open(SUBSCRIPTION_MANAGE_URL);
  return SUBSCRIPTION_MANAGE_URL;
}
