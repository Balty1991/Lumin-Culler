
import { intlTag } from '../i18n';/**
 * core/freedSpace.ts
 * Cât spațiu a eliberat aplicația, pe luni — „Ai eliberat 2,4 GB luna asta”.
 * Se adună din dimensiunea reală a fișierelor șterse (PhotoRecord.sizeBytes),
 * nu dintr-o estimare.
 */
const FREED_KEY = 'lumin-freed';

/** Spațiul eliberat de copie, pe luni: { '2026-10': bytes }. */
export function readFreed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(FREED_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function monthKey(at = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function recordFreed(bytes: number, at = Date.now()): void {
  if (!(bytes > 0)) return;
  const all = readFreed();
  const k = monthKey(at);
  all[k] = (all[k] ?? 0) + bytes;
  try { localStorage.setItem(FREED_KEY, JSON.stringify(all)); } catch { /* fără stocare */ }
}

export function freedSummary(at = Date.now()): { month: number; total: number } {
  const all = readFreed();
  return { month: all[monthKey(at)] ?? 0, total: Object.values(all).reduce((a, b) => a + (Number(b) || 0), 0) };
}

export function formatBytes(bytes: number, locale: string): string {
  const fmt = (n: number, d: number) => n.toLocaleString(intlTag(locale), { maximumFractionDigits: d });
  if (bytes >= 1e9) return `${fmt(bytes / 1e9, 1)} GB`;
  if (bytes >= 1e6) return `${fmt(bytes / 1e6, 0)} MB`;
  return `${fmt(Math.max(0, bytes) / 1e3, 0)} KB`;
}
