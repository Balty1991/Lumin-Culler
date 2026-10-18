import { beforeEach, describe, expect, it } from 'vitest';
import {
  FREE_AI_CLEAN_PER_DAY, commitAiClean, decideAiClean, localDay, readAiCleanState, writeAiCleanState,
  type AiCleanState
} from './aiCleanAllowance';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY = localDay(NOW);
const fresh: AiCleanState = { fullBasketsUsed: 0, day: DAY, usedToday: 0 };

beforeEach(() => localStorage.clear());

describe('decideAiClean', () => {
  it('lasă tot coșul să treacă la prima curățare, oricât e de mare', () => {
    const decision = decideAiClean({ count: 400, premium: false, enforced: true, state: fresh, now: NOW });
    expect(decision).toEqual({ kind: 'all', consumesFull: true, consumesDaily: 0 });
  });

  it('după prima curățare limitează la 50 pe zi și taie restul', () => {
    const used: AiCleanState = { fullBasketsUsed: 1, day: DAY, usedToday: 0 };
    expect(decideAiClean({ count: 40, premium: false, enforced: true, state: used, now: NOW }))
      .toEqual({ kind: 'all', consumesFull: false, consumesDaily: 40 });
    expect(decideAiClean({ count: 80, premium: false, enforced: true, state: used, now: NOW }))
      .toEqual({ kind: 'partial', take: FREE_AI_CLEAN_PER_DAY, consumesDaily: FREE_AI_CLEAN_PER_DAY });
  });

  it('oprește a treia curățare din aceeași zi', () => {
    const used: AiCleanState = { fullBasketsUsed: 1, day: DAY, usedToday: FREE_AI_CLEAN_PER_DAY };
    expect(decideAiClean({ count: 1, premium: false, enforced: true, state: used, now: NOW }).kind).toBe('blocked');
  });

  it('Premium și lipsa unei căi de plată nu consumă plafonul', () => {
    const used: AiCleanState = { fullBasketsUsed: 1, day: DAY, usedToday: FREE_AI_CLEAN_PER_DAY };
    const premium = decideAiClean({ count: 10, premium: true, enforced: true, state: used, now: NOW });
    expect(premium.kind === 'all' ? premium.consumesDaily : -1).toBe(0);
    expect(decideAiClean({ count: 10, premium: false, enforced: false, state: used, now: NOW }).kind).toBe('all');
  });

  it('o zi nouă reface cele 50, nu și coșul gratuit deja folosit', () => {
    const used: AiCleanState = { fullBasketsUsed: 1, day: DAY, usedToday: 50 };
    const nextDay = NOW + 36 * 60 * 60 * 1000;
    expect(decideAiClean({ count: 50, premium: false, enforced: true, state: used, now: nextDay }))
      .toEqual({ kind: 'all', consumesFull: false, consumesDaily: 50 });
  });
});

describe('commitAiClean', () => {
  it('scrie coșul gratuit o singură dată și numără doar ce s-a decis', () => {
    const after = commitAiClean(fresh, { kind: 'all', consumesFull: true, consumesDaily: 0 }, NOW);
    expect(after.fullBasketsUsed).toBe(1);
    expect(after.usedToday).toBe(0);
    const later = commitAiClean(after, { kind: 'partial', take: 50, consumesDaily: 50 }, NOW);
    expect(later.fullBasketsUsed).toBe(1);
    expect(later.usedToday).toBe(50);
  });

  it('rotunjește starea prin localStorage', () => {
    const next = commitAiClean(fresh, { kind: 'all', consumesFull: true, consumesDaily: 0 }, NOW);
    writeAiCleanState(next);
    expect(readAiCleanState(NOW).fullBasketsUsed).toBe(1);
  });
});
