/**
 * state/freeAllowance.ts
 * Cand merita spus ca plafonul gratuit se apropie.
 *
 * Pana acum, un utilizator gratuit afla de plafonul lunar in DOUA feluri, si
 * amandoua prost alese: fie se ducea singur in Meniu → Premium (adica exact
 * cand nu-l durea nimic), fie apasa Exportă si primea, DUPA export, un mesaj
 * ca a trecut de limita. Al doilea e cel mai prost moment posibil: omul afla
 * de perete lovindu-se de el, si il tine minte ca pe o pacaleala, nu ca pe o
 * ofertă.
 *
 * Regula de aici muta anuntul inainte: se spune cand mai e loc de manevra, cu
 * cifrele reale, o singura data per prag. Nu la fiecare pornire, si nu de la
 * prima poza — sub 60% din plafon nu exista niciun motiv sa deranjezi pe cineva
 * cu un plafon de care nici nu s-a apropiat.
 */

/** Cat de aproape e plafonul. `none` = nu se spune nimic. */
export type AllowanceLevel = 'none' | 'approaching' | 'critical' | 'reached';

/** Sub atat din plafon, tacere. */
export const APPROACHING_RATIO = 0.6;
/** De aici in sus, ultimul avertisment inainte de plafon. */
export const CRITICAL_RATIO = 0.9;

const STORAGE_KEY = 'lumin-allowance-dismissed';

/** In ce ordine cresc pragurile — un prag respins nu-l ascunde si pe urmatorul. */
const ORDER: AllowanceLevel[] = ['none', 'approaching', 'critical', 'reached'];

export function allowanceLevel(used: number, limit: number): AllowanceLevel {
  if (limit <= 0) return 'none';
  const ratio = used / limit;
  if (ratio >= 1) return 'reached';
  if (ratio >= CRITICAL_RATIO) return 'critical';
  if (ratio >= APPROACHING_RATIO) return 'approaching';
  return 'none';
}

/**
 * Se arata anuntul?
 *
 * `premiumLocked` e aceeasi conditie folosita peste tot in aplicatie: exista o
 * cale reala de plata pe dispozitivul asta. Fara ea (web/PWA, sau Play care nu
 * raspunde) nu se arata nimic — un plafon anuntat fara nicio posibilitate de
 * a-l ridica e doar o veste proasta, nu o oferta.
 */
export function shouldShowAllowanceNotice(
  level: AllowanceLevel,
  dismissed: AllowanceLevel,
  premiumLocked: boolean
): boolean {
  if (!premiumLocked) return false;
  if (level === 'none') return false;
  return ORDER.indexOf(level) > ORDER.indexOf(dismissed);
}

export function readDismissedLevel(): AllowanceLevel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return ORDER.includes(raw as AllowanceLevel) ? (raw as AllowanceLevel) : 'none';
  } catch {
    return 'none';
  }
}

export function writeDismissedLevel(level: AllowanceLevel): void {
  try {
    if (level === 'none') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // fara stocare, anuntul reapare la urmatoarea pornire — suparator, dar nu gresit
  }
}

/**
 * Fereastra se reinnoieste la 30 de zile (vezi core/entitlement.ts), deci
 * contorul scade singur. Cand a scazut sub pragul respins, uitam respingerea:
 * altfel, cineva care a respins "aproape de plafon" luna trecuta n-ar mai fi
 * anuntat niciodata, in nicio luna urmatoare.
 */
export function forgetDismissalIfBelow(level: AllowanceLevel, dismissed: AllowanceLevel): AllowanceLevel {
  return ORDER.indexOf(level) < ORDER.indexOf(dismissed) ? level : dismissed;
}

/**
 * Ce trebuie spus INAINTE de un export, nu dupa el.
 *
 * Mesajul de pana acum ("Ai trecut de 150 de poze scoase luna asta") se atasa
 * notificarii de DUPA export. Adica informatia sosea cand nu mai putea servi la
 * nimic: exportul se facuse deja. Aici se decide ce se spune in foaia de export,
 * cat timp omul inca poate alege altfel.
 *
 * `null` = nu se spune nimic. Nu se avertizeaza pe cineva care mai are loc
 * berechet — asta ar transforma fiecare export intr-o reclama.
 */
export type ExportAllowanceWarning = { kind: 'exceeds' | 'tight'; remaining: number };

/** Sub atat din plafon ramas DUPA export, merita spus ca se apropie sfarsitul. */
export const TIGHT_RATIO = 0.1;

export function exportAllowanceWarning(
  selected: number, used: number, limit: number, premiumLocked: boolean
): ExportAllowanceWarning | null {
  if (!premiumLocked || limit <= 0 || selected <= 0) return null;
  const remaining = Math.max(0, limit - used);
  if (selected > remaining) return { kind: 'exceeds', remaining };
  if (remaining - selected < limit * TIGHT_RATIO) return { kind: 'tight', remaining };
  return null;
}
