import type { Autonomy } from './twin';

/**
 * lumin/autonomyOffer.ts
 * „Autonomie câștigată”: când copia te nimerește des și fără să-ți piardă
 * pozele dragi, îți propune singură pasul următor (sugerează → decide sigurele
 * → decide tot). Niciodată mai mult de un pas și niciodată peste „tot”.
 *
 * Logica e pură (fără stocare, fără ceas), ca să se poată testa; amânarea
 * „Mai târziu” se ține în localStorage, separat.
 */
const SNOOZE_KEY = 'lumin-autonomy-offer-snooze';
/** Pragul de potrivire de la care propune pasul următor. */
export const OFFER_PERCENT = 85;
/** Sub atâtea decizii, procentul nu e încă o dovadă. */
export const OFFER_DECISIONS = 30;
/** „Mai târziu” ascunde cardul atâtea zile. */
export const SNOOZE_DAYS = 7;

export interface OfferInput {
  percent: number | null;
  decisions: number;
  /** Siguranța măsurată (readSafety().safe). */
  safe: boolean;
  autonomy: Autonomy;
  /** Până când e amânat (ms), sau null. */
  snoozedUntil: number | null;
  now: number;
}

export interface AutonomyOffer {
  from: Autonomy;
  to: Autonomy;
  percent: number;
  /** Pasul cere Pro (doar „decide tot”). */
  pro: boolean;
}

const NEXT: Record<Autonomy, Autonomy | null> = { suggest: 'sure', sure: 'all', all: null };

export function autonomyOfferFor(i: OfferInput): AutonomyOffer | null {
  const to = NEXT[i.autonomy];
  if (!to) return null;
  if (i.percent === null || i.percent < OFFER_PERCENT) return null;
  if (i.decisions < OFFER_DECISIONS || !i.safe) return null;
  if (i.snoozedUntil !== null && i.now < i.snoozedUntil) return null;
  return { from: i.autonomy, to, percent: i.percent, pro: to === 'all' };
}

export function readOfferSnooze(): number | null {
  try {
    const v = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

/** „Mai târziu”: nu mai întreabă SNOOZE_DAYS zile. */
export function snoozeOffer(now = Date.now()): void {
  try { localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_DAYS * 86_400_000)); } catch { /* fără stocare */ }
}
