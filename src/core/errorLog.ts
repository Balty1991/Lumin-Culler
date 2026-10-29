/**
 * core/errorLog.ts
 * Jurnalul de probleme, doar pe telefon: ultimele erori ale aplicației (cu ora
 * și ecranul), plus o închidere neașteptată raportată de partea nativă. Nu
 * pleacă singur nicăieri: omul îl trimite, dacă vrea, din Setări („Trimite un
 * raport”), ca fișier text, prin foaia de trimitere a telefonului.
 */
const KEY = 'lumin-error-log';
const MAX = 60;

export interface LoggedError { t: number; kind: string; message: string; where?: string }

export function readErrorLog(): LoggedError[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LoggedError[]; } catch { return []; }
}

export function logError(kind: string, message: string, where?: string): void {
  const entry: LoggedError = { t: Date.now(), kind, message: message.slice(0, 600), ...(where ? { where: where.slice(0, 300) } : {}) };
  const all = [...readErrorLog(), entry].slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

export function clearErrorLog(): void {
  try { localStorage.removeItem(KEY); } catch { /* fără stocare */ }
}

let installed = false;
/** Prinde erorile necaptate și promisiunile respinse. O singură dată, la pornire. */
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => {
    logError('error', e.message || String(e.error), e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    logError('promise', r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}

/** Textul raportului: versiunea, telefonul (fără date personale) și ultimele erori. */
export function buildErrorReport(info: Record<string, string | number>): string {
  const lines = [
    'Cherrypic — raport de probleme',
    ...Object.entries(info).map(([k, v]) => `${k}: ${v}`),
    `browser: ${typeof navigator !== 'undefined' ? navigator.userAgent : '-'}`,
    '',
    'Ultimele erori:'
  ];
  const log = readErrorLog();
  if (!log.length) lines.push('(niciuna)');
  for (const e of log.slice().reverse()) {
    lines.push(`- ${new Date(e.t).toISOString()} [${e.kind}] ${e.message}`);
    if (e.where) lines.push(`    ${e.where.split('\n').slice(0, 3).join(' | ')}`);
  }
  return lines.join('\n');
}
