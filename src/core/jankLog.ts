/**
 * core/jankLog.ts
 * Jurnalul blocajelor: de fiecare dată când ecranul stă pe loc peste 200 ms, se notează
 * cât a durat și ce făcea aplicația atunci (pasul marcat cu `jankMark`). Stă doar pe
 * telefon și pleacă numai dacă omul trimite raportul din Setări. Există pentru că
 * lentoarea din timpul citirii galeriei nu se poate măsura decât pe telefonul omului.
 */
const KEY = 'cherrypic.jank';
const MAX = 80;
const MIN_MS = 200;

export interface JankEntry { at: number; ms: number; doing: string }

const active = new Map<number, string>();
let seq = 0;
let entries: JankEntry[] | null = null;
let started = false;

function load(): JankEntry[] {
  if (entries) return entries;
  try { const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]'); entries = Array.isArray(raw) ? raw as JankEntry[] : []; }
  catch { entries = []; }
  return entries;
}

/** Marchează un pas: `const done = jankMark('fețe'); … done();`. Pașii pot fi suprapuși. */
export function jankMark(label: string): () => void {
  const id = ++seq;
  active.set(id, label);
  return () => { active.delete(id); };
}

/** Rulează `fn` sub un marcaj și îl ridică la final, orice s-ar întâmpla. */
export async function jankSpan<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const done = jankMark(label);
  try { return await fn(); } finally { done(); }
}

export function recordJank(ms: number, now = Date.now()): void {
  if (ms < MIN_MS) return;
  const list = load();
  list.push({ at: now, ms: Math.round(ms), doing: [...new Set(active.values())].join('+') || '-' });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* fără stocare */ }
}

export function startJankLog(): void {
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) recordJank(e.duration); }).observe({ entryTypes: ['longtask'] });
  } catch { /* WebView fără „longtask”: fără jurnal */ }
}

/** Rezumat pentru raport: total pe pas (cele mai grele întâi) și ultimele 12 blocaje. */
export function jankSummary(list: readonly JankEntry[] = load()): string {
  if (!list.length) return 'niciun blocaj peste 200 ms';
  const by = new Map<string, { n: number; total: number; max: number }>();
  for (const e of list) { const b = by.get(e.doing) ?? { n: 0, total: 0, max: 0 }; b.n++; b.total += e.ms; b.max = Math.max(b.max, e.ms); by.set(e.doing, b); }
  const top = [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10)
    .map(([k, v]) => `${k}: ${v.n}x, total ${v.total} ms, max ${v.max} ms`).join(' | ');
  const last = list.slice(-12).map(e => `${new Date(e.at).toISOString().slice(11, 19)} ${e.ms}ms ${e.doing}`).join(' ; ');
  return `${top} || ultimele: ${last}`;
}

export function clearJankLog(): void {
  entries = [];
  try { localStorage.removeItem(KEY); } catch { /* fără stocare */ }
}
