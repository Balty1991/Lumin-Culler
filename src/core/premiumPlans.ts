/**
 * core/premiumPlans.ts
 * Cum se citeste un plan de abonament langa altul: cat costa pe luna, si cat
 * economisesti luand anualul.
 *
 * Sta separat de core/billing.ts (puntea catre Play) fiindca e matematica pura
 * peste cifre deja primite — se testeaza pe numere, fara Android, fara Play, si
 * fara sa fie nevoie de un dispozitiv.
 *
 * REGULA din care decurge tot fisierul: nicio cifra nu se inventeaza si niciun
 * pret nu se parseaza din text. Play da pretul de doua ori — o data formatat in
 * moneda si conventiile contului (`price`: "19,99 lei", "$4.99") si o data brut,
 * in micro-unitati (`priceMicros`). Comparatiile se fac DOAR pe cifra bruta;
 * textul formatat se afiseaza ca atare sau se reconstruieste cu Intl, niciodata
 * nu se despica cu expresii regulate ca sa i se scoata numarul.
 *
 * De ce conteaza planul anual, ca decizie de produs: e singura parghie de venit
 * care nu cere nicio functie noua. Aduce incasarea anului in prima zi, scoate
 * unsprezece ocazii de renuntare din doisprezece, si ii da utilizatorului un
 * motiv onest sa plateasca mai putin pe luna. Dar are sens sa fie ARATAT ca
 * avantaj doar cand chiar e unul — de-aia `annualSavingsPercent` intoarce null
 * cand economia e nula sau negativa, in loc sa scrie "economisesti 0%".
 */
import type { PremiumPlan } from './billing';

/** ID-urile din Play Console. Aceleasi siruri ca in BillingPlugin.kt. */
export const MONTHLY_PLAN_ID = 'lumin_premium_monthly';
export const YEARLY_PLAN_ID = 'lumin_premium_yearly';

/**
 * Sub atat, "economisesti X%" nu merita spus.
 *
 * Un plan anual cu 2% mai ieftin nu e o oferta, e o rotunjire — iar o eticheta
 * de reducere pusa pe ea invata utilizatorul ca etichetele aplicatiei nu
 * inseamna nimic. Pragul e ales ca sa lase sa treaca reducerile reale (in
 * practica, un an platit odata costa cu 15-40% mai putin decat douasprezece
 * luni) si sa opreasca zgomotul.
 */
export const MIN_SAVINGS_PERCENT = 5;

/** Cat costa planul pe zi, in micro-unitati. Baza comuna de comparatie intre perioade diferite. */
function microsPerDay(plan: PremiumPlan): number | null {
  if (!(plan.periodDays > 0) || !(plan.priceMicros > 0)) return null;
  return plan.priceMicros / plan.periodDays;
}

/**
 * Cu cat la suta e mai ieftin `candidate` decat `reference`, la aceeasi durata.
 *
 * Rotunjit in JOS, deliberat: intre a promite 33% si a livra 32,8%, si a promite
 * 32% si a livra 32,8%, doar a doua varianta nu e o exagerare. Null cand una
 * dintre cifre lipseste sau cand economia e sub pragul de mai sus — apelantul nu
 * are atunci ce afisa, si asta e raspunsul, nu un zero.
 */
export function annualSavingsPercent(reference: PremiumPlan, candidate: PremiumPlan): number | null {
  const a = microsPerDay(reference);
  const b = microsPerDay(candidate);
  if (a === null || b === null) return null;
  const percent = Math.floor(((a - b) / a) * 100);
  return percent >= MIN_SAVINGS_PERCENT ? percent : null;
}

/**
 * Pretul unui plan exprimat pe luna, in moneda lui.
 *
 * "≈ 8,33 lei/luna" langa "99,99 lei/an" e singurul mod in care doua planuri cu
 * perioade diferite se pot compara dintr-o privire. Cifra e derivata din
 * `priceMicros` (30,44 zile pe luna — media unui an, nu 30, ca sa nu iasa 12,17
 * luni dintr-un an), iar formatarea o face Intl cu codul de moneda primit de la
 * Play, deci ramane corecta in orice tara.
 *
 * Null cand nu se poate calcula onest — fara moneda, fara perioada, sau pentru
 * un plan care oricum e lunar (unde ar repeta pretul deja afisat, cu un "≈" in
 * fata care l-ar face sa para mai putin sigur decat este).
 */
const DAYS_PER_MONTH = 30.44;

export function perMonthPrice(plan: PremiumPlan, locale: string): string | null {
  const perDay = microsPerDay(plan);
  if (perDay === null || !plan.currency) return null;
  if (plan.periodDays <= 31) return null; // deja e un pret lunar
  const amount = (perDay * DAYS_PER_MONTH) / 1_000_000;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: plan.currency }).format(amount);
  } catch {
    // Cod de moneda necunoscut lui Intl (nu s-a intamplat cu Play, dar raspunsul
    // vine din afara): mai bine nimic decat un numar fara moneda langa el.
    return null;
  }
}

/**
 * Planul propus bifat cand se deschide ecranul.
 *
 * Cel mai ieftin pe zi, cand chiar e mai ieftin cu adevarat (acelasi prag ca la
 * eticheta de economie); altfel primul din lista, adica ordinea in care le-a
 * asezat partea nativa — lunarul intai.
 *
 * De ce nu mereu anualul: o presolectie care nu e insotita de un avantaj
 * vizibil si real e doar un plan mai scump bifat din oficiu. Cand economia e
 * afisata langa el, alegerea ramane a utilizatorului si e informata; cand nu
 * exista economie, nu exista nici motiv sa fie mutata de pe implicit.
 */
export function defaultPlanId(plans: PremiumPlan[]): string | null {
  if (plans.length === 0) return null;
  const [first, ...rest] = plans;
  let best = first;
  for (const plan of rest) {
    if (annualSavingsPercent(best, plan) !== null) best = plan;
  }
  return best.id;
}

/** Planul cu acest id, sau planul implicit daca id-ul nu mai exista in lista. */
export function resolvePlan(plans: PremiumPlan[], wantedId: string | null): PremiumPlan | null {
  if (plans.length === 0) return null;
  return plans.find(p => p.id === wantedId) ?? plans.find(p => p.id === defaultPlanId(plans)) ?? null;
}
