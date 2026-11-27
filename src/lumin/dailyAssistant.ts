/**
 * lumin/dailyAssistant.ts
 * Mesajul de seară al copiei tale: „Azi am sortat 23 de poze ca tine. Pe 19
 * sunt sigur — te întreb doar de 4.” Din datele reale ale zilei, nu un text
 * generic. Fără zi cu ce spune, nu spune nimic (niciun spam).
 *
 * Funcții pure, fără React și fără punte nativă, ca să se poată testa. Puntea
 * spre notificare e în core/todayDigest.ts (setDailyAssistant).
 */
import { startOfDay } from '../core/todayDigest';

export interface AssistantPhoto {
  capturedAt?: number;
  importedAt: number;
  status: string;
  aiDecided?: boolean;
  aside?: string;
}

export interface AssistantCounts {
  /** Pozele de azi pe care AI-ul le-a citit și le-a pus undeva (sigur sau „te întreb”). */
  sorted: number;
  /** Hotărâte de AI singur: păstrate sau „Nu azi”. */
  sure: number;
  /** Lăsate omului: AI-ul nu e sigur și așteaptă un „da” sau „nu”. */
  ask: number;
  /** Toate pozele de azi cunoscute de aplicație (și cele hotărâte de om), pentru nativ. */
  known: number;
}

/** Sub atâtea poze sortate azi, seara nu deranjăm (la fel ca pragul nativ). */
export const MIN_SORTED = 3;

/** Acțiunea de deschidere: direct la pozele de ales ale zilei (vezi LuminApp). */
export const REVIEW_ACTION = 'review_today';

/**
 * Ziua pozei e ziua capturii, altfel a importului — aceeași regulă ca în
 * lumin/days.ts, ca mesajul să spună același lucru ca ecranul „Azi”.
 */
function photoDay(p: AssistantPhoto): number {
  return startOfDay(p.capturedAt ?? p.importedAt);
}

export function dailyAssistantCounts(photos: readonly AssistantPhoto[], now: number = Date.now()): AssistantCounts {
  const day = startOfDay(now);
  let sure = 0;
  let ask = 0;
  let known = 0;
  for (const p of photos) {
    if (photoDay(p) !== day) continue;
    known++;
    // Capturile și documentele stau deoparte: nu sunt „poze sortate ca tine”.
    if (p.aside) continue;
    if ((p.status === 'selected' || p.status === 'rejected') && p.aiDecided === true) sure++;
    // „review” = AI-ul a citit-o și nu e sigur. „pending” nu e citită încă, deci nu întreabă nimic.
    else if (p.status === 'review') ask++;
  }
  return { sorted: sure + ask, sure, ask, known };
}

export interface AssistantMessage {
  title: string;
  body: string;
  /** Unde duce atingerea: la cele de ales, sau doar pe „Azi” când n-ai nimic de verificat. */
  action: 'review_today' | 'today';
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Textul notificării, sau null când azi n-a fost nimic nou de sortat. */
export function composeDailyAssistant(counts: AssistantCounts, tr: Translate): AssistantMessage | null {
  const { sorted, sure, ask } = counts;
  if (sorted < MIN_SORTED) return null;
  const title = tr('lx.assistant.title', { count: sorted });
  let body: string;
  if (ask === 0) body = tr('lx.assistant.done');
  else if (sure === 0) body = tr('lx.assistant.allAsk', { ask });
  else if (ask === 1) body = tr('lx.assistant.askOne', { sure });
  else if (sure === 1) body = tr('lx.assistant.sureOne', { ask });
  else body = tr('lx.assistant.ask', { sure, ask });
  return { title, body, action: ask > 0 ? REVIEW_ACTION : 'today' };
}

/** Cheia zilei locale („2026-11-27”), aceeași pe care o calculează și receptorul nativ. */
export function localDayKey(now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
