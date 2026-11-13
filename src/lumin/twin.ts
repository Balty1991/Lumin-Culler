import { readDailyScore, readTasteScore } from '../core/tasteScore';

/**
 * lumin/twin.ts
 * „Copia ta”: cât de bine alege AI-ul ca tine, măsurat cinstit.
 *
 * Fiecare dată când sortezi o poză despre care AI-ul avea o părere, se notează
 * dacă ați ales la fel — părerea e luată ÎNAINTE de decizia ta, deci nu se
 * poate „ajusta” după. Procentul e pe ultimele WINDOW decizii, ca să arate cum
 * te cunoaște acum, nu media de la început. Până strânge destule, folosește
 * testul de gust (perechile); sub atât, spune cinstit că încă învață.
 *
 * Plus cât îi dai voie să facă singură (autonomia).
 */
const LOG_KEY = 'lumin-twin-log';
const AUTONOMY_KEY = 'lumin-autonomy';
const WINDOW = 120;
const MAX_LOG = 400;
/** Sub atâtea decizii, procentul ar fi zgomot. */
export const MIN_DECISIONS = 12;

export interface TwinEntry {
  t: number;
  same: boolean;
  /** AI-ul avea o decizie fermă (păstrat / scos), nu doar o înclinație. */
  firm?: boolean;
  aiKeep?: boolean;
  userKeep?: boolean;
  /** Poza avea oameni. */
  people?: boolean;
}

function readLog(): TwinEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(e => e && typeof e.t === 'number' && typeof e.same === 'boolean') : [];
  } catch { return []; }
}

/** Notează o decizie: `aiKeep` = ce credea AI-ul înainte, `userKeep` = ce ai ales tu. */
export function recordTwinDecision(aiKeep: boolean, userKeep: boolean, extra: { firm?: boolean; people?: boolean } = {}, now = Date.now()): void {
  const log = [...readLog(), { t: now, same: aiKeep === userKeep, aiKeep, userKeep, firm: extra.firm, people: extra.people }].slice(-MAX_LOG);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* fără stocare */ }
}

export interface TwinState {
  /** 0..100, sau null cât încă învață. */
  percent: number | null;
  /** Cu cât a crescut față de deciziile de dinainte (puncte), null fără destul istoric. */
  trend: number | null;
  decisions: number;
  level: 'learning' | 'little' | 'getting' | 'close' | 'twin';
}

export function twinFrom(log: readonly TwinEntry[], pairs = { hits: 0, total: 0 }): TwinState {
  const recent = log.slice(-WINDOW);
  let percent: number | null = null;
  if (recent.length >= MIN_DECISIONS) percent = Math.round((recent.filter(e => e.same).length / recent.length) * 100);
  else if (pairs.total >= 6) percent = Math.round((pairs.hits / pairs.total) * 100);
  const before = log.slice(-2 * WINDOW, -WINDOW).slice(-60);
  const now = log.slice(-60);
  const trend = before.length >= MIN_DECISIONS && now.length >= MIN_DECISIONS
    ? Math.round((now.filter(e => e.same).length / now.length - before.filter(e => e.same).length / before.length) * 100)
    : null;
  const level = percent === null ? 'learning' : percent < 60 ? 'little' : percent < 75 ? 'getting' : percent < 88 ? 'close' : 'twin';
  return { percent, trend, decisions: log.length + pairs.total, level };
}

/**
 * Siguranța, măsurată pe alegerile omului (etapa 1 a transformării):
 *  - `rejectPrecision`: din pozele scoase ferm de AI și văzute de om, câte a scos și omul;
 *  - `peopleRescued`: poze cu oameni scoase de AI pe care omul le-a păstrat (cei dragi
 *    pe care AI-ul i-ar fi pierdut). Ținta: zero.
 * Doar intrările noi (cu `firm`) contează; jurnalul vechi nu știa ce era ferm.
 */
export interface SafetyState { rejects: number; rejectPrecision: number | null; peopleRejects: number; peopleRescued: number; safe: boolean }
export const MIN_REJECTS = 15;
export const SAFE_PRECISION = 0.85;

export function safetyFrom(log: readonly TwinEntry[]): SafetyState {
  const firmRejects = log.slice(-WINDOW * 2).filter(e => e.firm && e.aiKeep === false);
  const agreed = firmRejects.filter(e => e.userKeep === false).length;
  const people = firmRejects.filter(e => e.people);
  const peopleRescued = people.filter(e => e.userKeep === true).length;
  const rejectPrecision = firmRejects.length >= MIN_REJECTS ? agreed / firmRejects.length : null;
  // Sigur = destule dovezi, precizie bună și cel mult o poză cu oameni salvată la 20.
  const safe = rejectPrecision !== null && rejectPrecision >= SAFE_PRECISION && peopleRescued * 20 <= Math.max(people.length, 1);
  return { rejects: firmRejects.length, rejectPrecision, peopleRejects: people.length, peopleRescued, safe };
}

export function readSafety(): SafetyState {
  return safetyFrom(readLog());
}

export function readTwin(): TwinState {
  // Înainte de jurnal: scorul zilnic strâns deja (aceeași măsurătoare), altfel perechile din test.
  const daily = readDailyScore();
  return twinFrom(readLog(), daily.total >= MIN_DECISIONS ? daily : readTasteScore());
}

/**
 * Cât îi dai voie copiei:
 * - suggest: doar îți arată pozele noi; tu pornești sortarea;
 * - sure: le aduce și le sortează singură, te întreabă doar de cele nesigure;
 * - all: decide tot, inclusiv cele nesigure (Pro).
 */
export type Autonomy = 'suggest' | 'sure' | 'all';

export function readAutonomy(): Autonomy {
  try {
    const v = localStorage.getItem(AUTONOMY_KEY);
    if (v === 'suggest' || v === 'sure' || v === 'all') return v;
    // Comutatorul vechi „Sortează singur” oprit = doar sugerează.
    if (localStorage.getItem('lumin-auto-sort') === 'off') return 'suggest';
  } catch { /* fără stocare */ }
  return 'sure';
}

export function writeAutonomy(a: Autonomy): void {
  try { localStorage.setItem(AUTONOMY_KEY, a); } catch { /* fără stocare */ }
}

export { recordFreed, freedSummary, formatBytes } from '../core/freedSpace';
