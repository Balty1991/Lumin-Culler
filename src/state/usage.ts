/**
 * state/usage.ts
 * Contor PUR STATISTIC: cate poze a analizat aplicatia in luna calendaristica
 * curenta. Il arata ecranul Statistici, si atat.
 *
 * NU e un plafon si nu are legatura cu abonamentul. Modelul freemium chiar
 * aplicat traieste in core/entitlement.ts si numara cu totul altceva — pozele
 * SCOASE din aplicatie (exportate sau sterse din telefon), intr-o fereastra
 * glisanta de 30 de zile.
 *
 * Fisierul asta a inceput ca schela pentru un "nivel gratuit" de 750 de imagini
 * procesate pe luna, iar acel prag a supravietuit dupa ce modelul s-a schimbat.
 * Rezultatul, gasit la audit: aceluiasi utilizator i se aratau DOUA niveluri
 * gratuite diferite, cu doua cifre diferite — unul la import ("ai trecut de
 * pragul de 750"), altul pe ecranul Premium ("150 de poze la 30 de zile") — iar
 * primul nu exista nicaieri in cod ca limita. Cine importa 800 de poze credea
 * ca a consumat ceva, desi triajul e si ramane nelimitat si gratuit, exact cum
 * promite ecranul Premium.
 *
 * De aceea pragul a fost scos de tot, nu doar ascuns: un numar care nu
 * restrictioneaza nimic, dar e prezentat ca limita, e mai rau decat lipsa lui.
 */
const STORAGE_KEY = 'lumin-usage-monthly';

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
