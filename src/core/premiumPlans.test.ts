import { describe, expect, it } from 'vitest';
import {
  annualSavingsPercent, perMonthPrice, defaultPlanId, resolvePlan,
  MIN_SAVINGS_PERCENT, MONTHLY_PLAN_ID, YEARLY_PLAN_ID
} from './premiumPlans';
import type { PremiumPlan } from './billing';

function plan(over: Partial<PremiumPlan> = {}): PremiumPlan {
  return {
    id: MONTHLY_PLAN_ID,
    price: '19,99 lei',
    priceMicros: 19_990_000,
    currency: 'RON',
    periodDays: 30,
    ...over
  };
}

const LUNAR = plan();
/** 199,99 lei/an fata de 19,99 lei/luna = ~16,66 lei/luna, adica ~16% mai ieftin. */
const ANUAL = plan({ id: YEARLY_PLAN_ID, price: '199,99 lei', priceMicros: 199_990_000, periodDays: 365 });

describe('annualSavingsPercent', () => {
  it('spune cu cat la suta e mai ieftin planul lung, raportat la zi', () => {
    // 19,99/30 = 0,666 pe zi; 199,99/365 = 0,548 pe zi -> 17% mai ieftin.
    expect(annualSavingsPercent(LUNAR, ANUAL)).toBe(17);
  });

  it('rotunjeste in jos, ca cifra afisata sa nu promita mai mult decat livreaza', () => {
    // Exact 25,5% economie: 0,5 pe zi fata de 0,3725 pe zi.
    const a = plan({ priceMicros: 30_000_000, periodDays: 60 });      // 0,5/zi
    const b = plan({ priceMicros: 22_350_000, periodDays: 60 });      // 0,3725/zi
    expect(annualSavingsPercent(a, b)).toBe(25);
  });

  it('tace cand economia e sub prag — o reducere de rotunjire nu e o oferta', () => {
    const abiaMaiIeftin = plan({ id: YEARLY_PLAN_ID, priceMicros: 233_000_000, periodDays: 365 });
    const procent = Math.floor(((19_990_000 / 30 - 233_000_000 / 365) / (19_990_000 / 30)) * 100);
    expect(procent).toBeLessThan(MIN_SAVINGS_PERCENT);
    expect(annualSavingsPercent(LUNAR, abiaMaiIeftin)).toBeNull();
  });

  it('tace si cand planul lung e mai SCUMP pe zi, in loc sa raporteze un procent negativ', () => {
    const maiScump = plan({ id: YEARLY_PLAN_ID, priceMicros: 300_000_000, periodDays: 365 });
    expect(annualSavingsPercent(LUNAR, maiScump)).toBeNull();
  });

  it('tace cand lipsesc cifrele din care s-ar calcula', () => {
    // periodDays 0 = partea nativa n-a putut citi durata ciclului de facturare.
    expect(annualSavingsPercent(plan({ periodDays: 0 }), ANUAL)).toBeNull();
    expect(annualSavingsPercent(LUNAR, plan({ id: YEARLY_PLAN_ID, periodDays: 0 }))).toBeNull();
  });
});

describe('perMonthPrice', () => {
  it('imparte pretul anual la luna, in moneda primita de la Play', () => {
    const text = perMonthPrice(ANUAL, 'ro-RO');
    expect(text).not.toBeNull();
    // Nu comparam sirul exact: formatarea (spatiu ingust, pozitia monedei)
    // difera intre versiuni de ICU. Verificam cifra, care e a noastra.
    // 199,99 / 365 * 30,44 = 16,68
    expect(text).toMatch(/16[.,]6\d/);
    expect(text).toMatch(/RON|lei/i);
  });

  it('nu repeta pretul unui plan care e deja lunar', () => {
    expect(perMonthPrice(LUNAR, 'ro-RO')).toBeNull();
    // Nici pentru un ciclu de 31 de zile — tot o luna e.
    expect(perMonthPrice(plan({ periodDays: 31 }), 'ro-RO')).toBeNull();
  });

  it('nu afiseaza un numar fara moneda cand codul de moneda lipseste sau e necunoscut', () => {
    expect(perMonthPrice({ ...ANUAL, currency: '' }, 'ro-RO')).toBeNull();
    expect(perMonthPrice({ ...ANUAL, currency: 'NU-I-MONEDA' }, 'ro-RO')).toBeNull();
  });
});

describe('defaultPlanId', () => {
  it('bifeaza planul cu economie reala, cand exista unul', () => {
    expect(defaultPlanId([LUNAR, ANUAL])).toBe(YEARLY_PLAN_ID);
  });

  it('ramane pe primul plan cand al doilea nu aduce nicio economie', () => {
    const laFel = plan({ id: YEARLY_PLAN_ID, priceMicros: 243_212_000, periodDays: 365 });
    expect(defaultPlanId([LUNAR, laFel])).toBe(MONTHLY_PLAN_ID);
  });

  it('cu un singur plan, alege acel plan', () => {
    expect(defaultPlanId([LUNAR])).toBe(MONTHLY_PLAN_ID);
  });

  it('fara niciun plan (produse neconfigurate in Play Console) nu inventeaza unul', () => {
    expect(defaultPlanId([])).toBeNull();
  });
});

describe('resolvePlan', () => {
  it('intoarce planul cerut cand mai exista', () => {
    expect(resolvePlan([LUNAR, ANUAL], MONTHLY_PLAN_ID)).toBe(LUNAR);
  });

  it('cade pe implicit cand planul bifat a disparut din raspunsul lui Play', () => {
    // Se poate intampla intre doua deschideri ale ecranului: un plan retras din
    // Play Console, sau o oferta care a expirat. Fara asta, butonul de cumparare
    // ar fi ramas legat de un id pe care partea nativa il respinge.
    expect(resolvePlan([ANUAL], MONTHLY_PLAN_ID)).toBe(ANUAL);
  });

  it('fara planuri, intoarce null in loc sa ghiceasca', () => {
    expect(resolvePlan([], YEARLY_PLAN_ID)).toBeNull();
  });
});
