/**
 * state/usage.ts
 * Contor local de utilizare lunara (poze procesate) — scaffolding pentru viitorul
 * model freemium (plan 4.2): "Nivelul Freemium (Gratuit): functionalitati de baza
 * de culling cu o limita de procesare (ex. 500-1000 imagini/luna)".
 *
 * IMPORTANT — ce NU e asta: nu e un sistem real de licentiere sau de plata.
 * E doar un contor informativ, persistat in localStorage, pe care orice
 * utilizator cu acces la devtools il poate reseta/ocoli instant. O aplicatie
 * 100% locala/offline-first, fara server propriu, nu poate impune real o
 * limita fara un backend de validare a licentei (si un procesator de plati,
 * ex. Stripe/Paddle) — acela ramane un proiect de business separat, pentru
 * cand exista un asemenea backend. Pana atunci, acest contor doar informeaza
 * utilizatorul cand a depasit pragul sugerat de plan, FARA sa blocheze vreo
 * functionalitate — o limita blocanta, fara validare reala pe server, ar fi
 * doar teatru (trivial de ocolit) si ar induce in eroare utilizatorul in
 * privinta a ceea ce chiar restrictioneaza aplicatia.
 */
const STORAGE_KEY = 'lumin-usage-monthly';

/** Mijlocul intervalului 500-1000 imagini/luna sugerat in plan pentru nivelul Freemium. */
export const FREE_TIER_MONTHLY_LIMIT = 750;

interface UsageRecord { month: string; count: number; }

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function readUsage(): UsageRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UsageRecord>;
      if (parsed.month === currentMonthKey() && typeof parsed.count === 'number') {
        return { month: parsed.month, count: parsed.count };
      }
    }
  } catch {
    // JSON corupt sau stocare indisponibila — repornim contorul de la 0
  }
  return { month: currentMonthKey(), count: 0 }; // luna noua (sau prima folosire) = contor la zero
}

function writeUsage(u: UsageRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  } catch {
    // stocare indisponibila (mod privat strict etc.) — contorul tot se aplica pentru sesiunea curenta
  }
}

/** Adauga `n` poze la contorul lunii curente (reseteaza automat la schimbarea lunii) si returneaza noul total. */
export function recordUsage(n: number): number {
  if (n <= 0) return readUsage().count;
  const u = readUsage();
  u.count += n;
  writeUsage(u);
  return u.count;
}

export function readMonthlyUsage(): number {
  return readUsage().count;
}
