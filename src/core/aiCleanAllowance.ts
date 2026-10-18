/**
 * core/aiCleanAllowance.ts
 * Cât din „Curăță tot” rămâne gratuit.
 *
 * Swipe-ul manual (o poză, o decizie, apoi confirmarea sistemului) nu trece
 * pe aici și nu se numără. Nici exportul: ăla rămâne la FREE_PHOTOS_PER_MONTH
 * din entitlement.ts. Aici e doar gestul care șterge un coș întreg pentru că
 * AI-ul a ales deja.
 *
 * Prima curățare completă e gratuită, oricât de mare e coșul — e momentul în
 * care omul vede că aplicația chiar eliberează spațiu. După ea, încă 50 de
 * poze pe zi. Peste asta, „Curăță tot” e Premium. Cine nu are o cale reală de
 * plată (web, sau Play care a spus că produsul nu există) nu e oprit: un
 * plafon fără ieșire e peretele pe care entitlement.ts îl refuză.
 */

export const FREE_AI_CLEAN_BASKETS = 1;
export const FREE_AI_CLEAN_PER_DAY = 50;

const STORAGE_KEY = 'lumin-ai-clean';

export interface AiCleanState {
  /** Câte coșuri complete gratuite s-au folosit. 0 sau 1, în practică. */
  fullBasketsUsed: number;
  /** Ziua locală YYYY-MM-DD în care s-a numărat `usedToday`. */
  day: string;
  usedToday: number;
}

export const EMPTY_AI_CLEAN: AiCleanState = { fullBasketsUsed: 0, day: '', usedToday: 0 };

export type AiCleanDecision =
  | { kind: 'all'; consumesFull: boolean; consumesDaily: number }
  | { kind: 'partial'; take: number; consumesDaily: number }
  | { kind: 'blocked' };

export function localDay(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function readAiCleanState(now = Date.now()): AiCleanState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_AI_CLEAN };
    const parsed = JSON.parse(raw) as Partial<AiCleanState>;
    const fullBasketsUsed = parsed.fullBasketsUsed === 1 ? 1 : 0;
    const day = typeof parsed.day === 'string' ? parsed.day : '';
    const usedToday = day === localDay(now) && typeof parsed.usedToday === 'number' && parsed.usedToday > 0
      ? Math.floor(parsed.usedToday)
      : 0;
    return { fullBasketsUsed, day: usedToday ? day : localDay(now), usedToday };
  } catch {
    return { ...EMPTY_AI_CLEAN, day: localDay(now) };
  }
}

export function writeAiCleanState(state: AiCleanState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // fără stocare, următoarea curățare se judecă de la zero — în favoarea omului
  }
}

/**
 * `enforced` e isPremiumFeatureLocked(): există o cale de plată și omul nu e
 * abonat. Premium, sau un dispozitiv pe care nu se poate plăti, trece tot coșul.
 */
export function decideAiClean(opts: {
  count: number;
  premium: boolean;
  enforced: boolean;
  state: AiCleanState;
  now?: number;
}): AiCleanDecision {
  const count = Math.max(0, Math.floor(opts.count));
  if (count === 0) return { kind: 'all', consumesFull: false, consumesDaily: 0 };
  if (opts.premium || !opts.enforced) return { kind: 'all', consumesFull: false, consumesDaily: 0 };
  if (opts.state.fullBasketsUsed < FREE_AI_CLEAN_BASKETS) {
    return { kind: 'all', consumesFull: true, consumesDaily: 0 };
  }
  const now = opts.now ?? Date.now();
  const used = opts.state.day === localDay(now) ? opts.state.usedToday : 0;
  const remaining = Math.max(0, FREE_AI_CLEAN_PER_DAY - used);
  if (remaining <= 0) return { kind: 'blocked' };
  if (count <= remaining) return { kind: 'all', consumesFull: false, consumesDaily: count };
  return { kind: 'partial', take: remaining, consumesDaily: remaining };
}

/** Aplică o decizie deja arătată omului. Nu numără ce nu s-a șters. */
export function commitAiClean(state: AiCleanState, decision: AiCleanDecision, now = Date.now()): AiCleanState {
  const day = localDay(now);
  const usedToday = state.day === day ? state.usedToday : 0;
  const consumesDaily = decision.kind === 'blocked' ? 0 : decision.consumesDaily;
  const consumesFull = decision.kind === 'all' && decision.consumesFull;
  return {
    fullBasketsUsed: state.fullBasketsUsed + (consumesFull ? 1 : 0),
    day,
    usedToday: usedToday + consumesDaily
  };
}
