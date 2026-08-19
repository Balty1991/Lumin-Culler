/**
 * core/aiFeedback.ts
 *
 * "AI a greșit?" — un buton discret, cu motive fixe.
 *
 * In cele 14 zile de testare inchisa, feedback-ul liber produce propozitii pe
 * care nu le poti numara: "nu prea merge", "e ciudat uneori". Cateva categorii
 * fixe produc in schimb un numar pe care il poti urmari intre versiuni si pe
 * care il poti lega de o schimbare anume in ponderi sau in praguri. De aceea
 * lista de motive e SCURTA si INCHISA, iar "altceva" exista tocmai ca sa nu
 * impinga oamenii sa aleaga gresit dintre celelalte.
 *
 * CE SE INREGISTREAZA: categoria, momentul, si scorul AI al pozei in cauza —
 * un numar intre 0 si 100. Niciun nume de fisier, niciun id, nicio miniatura,
 * niciun chip. Scorul e pastrat pentru ca raspunde la intrebarea utila: se
 * plange lumea de pozele pe care AI-ul le-a judecat cu incredere (scor mare)
 * sau de cele de la limita? Cele doua cazuri cer remedii diferite.
 *
 * Totul sta local si se sterge dintr-o apasare. Daca vreodata pleaca de pe
 * dispozitiv, aceea e o decizie separata, cu opt-in explicit.
 */

/** Motivele posibile. Ordinea e cea de afisare, de la cel mai des la cel mai rar asteptat. */
export const FEEDBACK_REASONS = [
  'wrongPick',        // a preferat poza gresita din serie
  'missedDuplicate',  // a ratat un duplicat / o serie
  'missedClosedEyes', // n-a vazut ochiul inchis
  'wrongReject',      // a respins o poza buna
  'tooSlow',          // a durat prea mult
  'other'
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

const KEY = 'lumin-ai-feedback';
/** Peste atat, taiem cele mai vechi: jurnalul e pentru tendinte, nu pentru arhiva. */
export const MAX_ENTRIES = 500;

export interface FeedbackEntry {
  reason: FeedbackReason;
  /** Momentul raportarii (epoch ms). */
  ts: number;
  /** Scorul AI al pozei raportate, 0..100. Absent daca nu era disponibil. */
  score?: number;
}

function isEntry(v: unknown): v is FeedbackEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<FeedbackEntry>;
  if (!(FEEDBACK_REASONS as readonly string[]).includes(e.reason as string)) return false;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return false;
  if (e.score !== undefined && (typeof e.score !== 'number' || !Number.isFinite(e.score))) return false;
  return true;
}

export function readFeedback(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Inregistreaza un raport. Intoarce lista rezultata, ca apelantul sa nu mai citeasca inca o data. */
export function recordFeedback(reason: FeedbackReason, score?: number, now = Date.now()): FeedbackEntry[] {
  const entry: FeedbackEntry = { reason, ts: now };
  if (typeof score === 'number' && Number.isFinite(score)) entry.score = Math.round(score);
  const next = [...readFeedback(), entry].slice(-MAX_ENTRIES);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {
    // stocare plina — raportul se pierde, dar nu blocam interfata pentru asta
  }
  return next;
}

export function resetFeedback(): void {
  try { localStorage.removeItem(KEY); } catch {
    // vezi recordFeedback
  }
}

export interface FeedbackSummary {
  reason: FeedbackReason;
  count: number;
  /** Scorul AI mediu al pozelor raportate cu acest motiv; `null` daca niciuna n-avea scor. */
  avgScore: number | null;
}

/**
 * Rezumat pe motive, descrescator dupa numar. Doar motivele raportate macar o
 * data — o lista de zerouri n-ar spune nimic si ar sugera ca lipseste ceva.
 */
export function summariseFeedback(entries = readFeedback()): FeedbackSummary[] {
  const byReason = new Map<FeedbackReason, { count: number; scoreSum: number; scoreCount: number }>();
  for (const e of entries) {
    const acc = byReason.get(e.reason) ?? { count: 0, scoreSum: 0, scoreCount: 0 };
    acc.count++;
    if (e.score !== undefined) { acc.scoreSum += e.score; acc.scoreCount++; }
    byReason.set(e.reason, acc);
  }
  return [...byReason.entries()]
    .map(([reason, a]) => ({
      reason,
      count: a.count,
      avgScore: a.scoreCount ? Math.round(a.scoreSum / a.scoreCount) : null
    }))
    .sort((a, b) => b.count - a.count || FEEDBACK_REASONS.indexOf(a.reason) - FEEDBACK_REASONS.indexOf(b.reason));
}
