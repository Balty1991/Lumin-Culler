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

const active = new Map<number, { label: string; start: number }>();
/** Pașii terminați recent (ultimele ~15 s): un blocaj se atribuie pașilor care s-au suprapus cu el. */
const recent: { label: string; start: number; end: number }[] = [];
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
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  active.set(id, { label, start });
  return () => {
    const a = active.get(id);
    active.delete(id);
    if (!a) return;
    const end = typeof performance !== 'undefined' ? performance.now() : 0;
    recent.push({ label: a.label, start: a.start, end });
    while (recent.length && (recent.length > 400 || end - recent[0].end > 15_000)) recent.shift();
  };
}

/** Pașii care s-au suprapus cu intervalul [start, start+ms]; cei mai scurți (cei mai precizi) primii. */
function overlapping(start: number, ms: number): string {
  const end = start + ms;
  const hits = new Map<string, number>();
  for (const s of recent) if (s.start < end && s.end > start) hits.set(s.label, Math.min(hits.get(s.label) ?? Infinity, s.end - s.start));
  for (const a of active.values()) if (a.start < end) hits.set(a.label, Math.min(hits.get(a.label) ?? Infinity, Infinity));
  return [...hits.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(e => e[0]).join('+') || '-';
}

/** Rulează `fn` sub un marcaj și îl ridică la final, orice s-ar întâmpla. */
export async function jankSpan<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const done = jankMark(label);
  try { return await fn(); } finally { done(); }
}

/**
 * Starea în clipa blocajului (câte poze în lucru, de când n-a mai atins omul ecranul, modul
 * citirii). Fără ea nu se putea spune dacă omul a simțit blocajul sau a fost cu ecranul neatins.
 */
let contextOf: (() => string) | null = null;
export function setJankContext(fn: () => string): void { contextOf = fn; }

export function recordJank(ms: number, now = Date.now(), startedAt?: number, detail?: string): void {
  if (ms < MIN_MS) return;
  const list = load();
  const doing = startedAt !== undefined
    ? overlapping(startedAt, ms)
    : [...new Set([...active.values()].map(a => a.label))].join('+') || '-';
  let ctx = '';
  try { ctx = contextOf ? ` {${contextOf()}}` : ''; } catch { /* fără context */ }
  list.push({ at: now, ms: Math.round(ms), doing: (detail ? `${doing} [${detail}]` : doing) + ctx });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* fără stocare */ }
}

export function startJankLog(): void {
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;
  // Cât aplicația stă în fundal, „blocajul” e doar timpul cât a fost înghețată de Android
  // (raportul din 12 nov.: „max 67948 ms”) — nu se numără.
  const hidden = () => typeof document !== 'undefined' && document.visibilityState !== 'visible';
  // Un cadru care a început înainte de ultima revenire pe ecran a cuprins și timpul cât aplicația
  // a stat în fundal (raportul din 12 nov.: „blocaje” de 52, 128 și 256 s) — nu se numără.
  let shownAt = 0;
  try {
    document.addEventListener('visibilitychange', () => { if (!hidden()) shownAt = performance.now(); });
  } catch { /* fără document */ }
  const spansHidden = (startTime: number) => startTime < shownAt;
  // Long Animation Frames (Chrome 123+): cine a rulat în cadrul blocat — funcția, fișierul,
  // cine a chemat-o (timer, promisiune, eveniment) — și cât a ținut desenarea. Fără el,
  // blocajele se puteau doar lega de pașii care rulau atunci.
  try {
    if ((PerformanceObserver.supportedEntryTypes ?? []).includes('long-animation-frame')) {
      new PerformanceObserver(l => {
        if (hidden()) return;
        for (const e of l.getEntries()) { if (!spansHidden(e.startTime)) recordJank(e.duration, Date.now(), e.startTime, loafDetail(e as LoafEntry)); }
      }).observe({ type: 'long-animation-frame', buffered: false });
      return;
    }
  } catch { /* cade pe „longtask” */ }
  try {
    new PerformanceObserver(l => { if (hidden()) return; for (const e of l.getEntries()) { if (!spansHidden(e.startTime)) recordJank(e.duration, Date.now(), e.startTime); } }).observe({ entryTypes: ['longtask'] });
  } catch { /* WebView fără „longtask”: fără jurnal */ }
}

/** Rezumat pentru raport: total pe pas (cele mai grele întâi) și ultimele 12 blocaje. */
export function jankSummary(list: readonly JankEntry[] = load()): string {
  if (!list.length) return 'niciun blocaj peste 200 ms';
  const by = new Map<string, { n: number; total: number; max: number }>();
  const bare = (d: string) => d.replace(/ \{[^{}]*\}$/, '');
  for (const e of list) { const k = bare(e.doing).replace(/ \[.*\]$/, ''); const b = by.get(k) ?? { n: 0, total: 0, max: 0 }; b.n++; b.total += e.ms; b.max = Math.max(b.max, e.ms); by.set(k, b); }
  // Cine a rulat în blocaje (Long Animation Frames): funcțiile cele mai des întâlnite.
  const who = new Map<string, { n: number; total: number }>();
  for (const e of list) {
    const m = bare(e.doing).match(/\[(.*)\]$/);
    if (!m) continue;
    for (const part of m[1].split('; ')) {
      const k = part.replace(/ \d+ms.*$/, '').replace(/^desen.*/, 'desen');
      const ms = Number(part.match(/(\d+)ms/)?.[1] ?? 0);
      const w = who.get(k) ?? { n: 0, total: 0 }; w.n++; w.total += ms; who.set(k, w);
    }
  }
  const whoText = [...who.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([k, v]) => `${k}: ${v.n}x ${v.total}ms`).join(' | ');
  const top = [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10)
    .map(([k, v]) => `${k}: ${v.n}x, total ${v.total} ms, max ${v.max} ms`).join(' | ');
  const last = list.slice(-12).map(e => `${new Date(e.at).toISOString().slice(11, 19)} ${e.ms}ms ${e.doing}`).join(' ; ');
  // „Simțite”: blocajele din cele 2 secunde de după o atingere — pe ele le vede omul.
  const felt = list.filter(e => { const m = e.doing.match(/atins acum (\d+)s/); return !!m && Number(m[1]) <= 2; });
  const feltText = list.some(e => /atins acum/.test(e.doing))
    ? ` || simtite (la atingere): ${felt.length} din ${list.length}${felt.length ? `, max ${Math.max(...felt.map(e => e.ms))} ms` : ''}`
    : '';
  return `${top}${whoText ? ` || cine: ${whoText}` : ''}${feltText} || ultimele: ${last}`;
}

export function clearJankLog(): void {
  entries = [];
  try { localStorage.removeItem(KEY); } catch { /* fără stocare */ }
}

interface LoafScript { duration: number; invoker?: string; invokerType?: string; sourceURL?: string; sourceFunctionName?: string; forcedStyleAndLayoutDuration?: number }
interface LoafEntry extends PerformanceEntry { renderStart?: number; styleAndLayoutStart?: number; blockingDuration?: number; scripts?: LoafScript[] }

/** „2 scripturi cele mai lungi + cât a ținut desenarea”, scurt, pentru raport. */
export function loafDetail(e: LoafEntry): string {
  const file = (u?: string) => (u ?? '').split('?')[0].split('/').pop()?.replace(/-[A-Za-z0-9_]{6,}\.js$/, '.js') || '?';
  const scripts = [...(e.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 2)
    .map(sc => `${sc.invoker || sc.invokerType || '?'}→${sc.sourceFunctionName || '?'}@${file(sc.sourceURL)} ${Math.round(sc.duration)}ms${sc.forcedStyleAndLayoutDuration && sc.forcedStyleAndLayoutDuration > 20 ? ` (layout forțat ${Math.round(sc.forcedStyleAndLayoutDuration)}ms)` : ''}`);
  const end = e.startTime + e.duration;
  const render = e.renderStart ? Math.round(end - e.renderStart) : 0;
  const layout = e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : 0;
  const parts = [...scripts];
  if (render > 30) parts.push(`desen ${render}ms` + (layout > 30 ? ` (stil+layout ${layout}ms)` : ''));
  if (!scripts.length && !render) parts.push('fără script (GC/sistem)');
  return parts.join('; ');
}
