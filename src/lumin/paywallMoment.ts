/**
 * lumin/paywallMoment.ts
 * Când are voie să apară oferta Pro, și jurnalul local al momentelor.
 *
 * Nu e primul ecran după instalare. Ofertele automate (după o curățenie,
 * după o serie de decizii) sunt cel mult una pe sesiune și una pe zi.
 * Deschiderea din Setări nu trece pe aici: omul a cerut ecranul.
 *
 * Jurnalul stă pe telefon. Nu pleacă nicăieri. Se citește din Setări → Diagnostic.
 */
const DAY_KEY = 'cp.paywall.day';
const LOG_KEY = 'cp.paywall.log';
const CONTEXT_KEY = 'cp.paywall.context';
const MAX_LOG = 40;

export type PaywallEvent =
  | 'paywall_shown'
  | 'paywall_dismissed'
  | 'trial_started'
  | 'purchase_monthly'
  | 'purchase_yearly'
  | 'purchase_lifetime';

export interface PaywallLogEntry {
  at: number;
  event: PaywallEvent;
  source: string;
}

let sessionUsed = false;

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Poate apărea o ofertă automată acum? Dacă da, marchează ziua și sesiunea. */
export function claimPaywall(now = Date.now()): boolean {
  if (sessionUsed) return false;
  try {
    if (localStorage.getItem(DAY_KEY) === dayKey(now)) return false;
    localStorage.setItem(DAY_KEY, dayKey(now));
  } catch {
    return false;
  }
  sessionUsed = true;
  return true;
}

/** Doar pentru teste: o sesiune nouă. */
export function resetPaywallSession(): void {
  sessionUsed = false;
}

export function setPaywallContext(text: string): void {
  try { localStorage.setItem(CONTEXT_KEY, text); } catch { /* fără stocare */ }
}

export function readPaywallContext(): string {
  try { return localStorage.getItem(CONTEXT_KEY) ?? ''; } catch { return ''; }
}

export function logPaywall(event: PaywallEvent, source: string, now = Date.now()): void {
  const entry: PaywallLogEntry = { at: now, event, source };
  try {
    const prev = readPaywallLog();
    localStorage.setItem(LOG_KEY, JSON.stringify([entry, ...prev].slice(0, MAX_LOG)));
  } catch { /* fără stocare */ }
}

export function readPaywallLog(): PaywallLogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is PaywallLogEntry => !!e && typeof e.event === 'string' && typeof e.at === 'number');
  } catch {
    return [];
  }
}

/** ID-ul Play → evenimentul de cumpărare. Necunoscut = null (nu inventăm un plan). */
export function purchaseEvent(planId: string | undefined): PaywallEvent | null {
  if (planId === 'lumin_premium_monthly') return 'purchase_monthly';
  if (planId === 'lumin_premium_yearly') return 'purchase_yearly';
  if (planId === 'cherrypic_pro_forever') return 'purchase_lifetime';
  return null;
}
