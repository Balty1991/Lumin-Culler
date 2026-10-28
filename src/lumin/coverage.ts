import { useEffect, useState } from 'react';
import { countGalleryPhotosSince, isNativeMediaLibraryAvailable, readGalleryDateRange } from '../core/nativeMediaLibrary';

/**
 * lumin/coverage.ts
 * Cât din galeria telefonului e sortat. Raportat: „nu știi ce ai sortat și ce
 * nu”. Pe luni: câte poze are galeria în luna aceea, câte a văzut AI-ul și
 * câte mai așteaptă o decizie.
 */
export interface CoveragePhoto {
  capturedAt?: number;
  importedAt: number;
  status: string;
  aside?: string;
}

export interface MonthCoverage {
  start: number;
  end: number;
  inGallery: number;
  seen: number;
  waiting: number;
}

export function monthStart(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function nextMonth(start: number): number {
  const d = new Date(start);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** Lunile de la cea mai nouă la cea mai veche, cu ce a văzut AI-ul în fiecare. */
export function buildCoverage(galleryCounts: Map<number, number>, photos: readonly CoveragePhoto[]): MonthCoverage[] {
  const seen = new Map<number, { seen: number; waiting: number }>();
  for (const p of photos) {
    const m = monthStart(p.capturedAt ?? p.importedAt);
    const row = seen.get(m) ?? { seen: 0, waiting: 0 };
    row.seen++;
    if (!p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate')) row.waiting++;
    seen.set(m, row);
  }
  const months = new Set([...galleryCounts.keys(), ...seen.keys()]);
  return [...months].sort((a, b) => b - a).map(start => ({
    start,
    end: nextMonth(start),
    inGallery: Math.max(galleryCounts.get(start) ?? 0, seen.get(start)?.seen ?? 0),
    seen: seen.get(start)?.seen ?? 0,
    waiting: seen.get(start)?.waiting ?? 0
  }));
}

/** Câte poze are galeria în fiecare lună (doar pe telefon; pe web, nimic). */
let cache: { key: number; at: number; counts: Map<number, number> } | null = null;
const CACHE_MS = 60_000;

export function useGalleryMonths(refresh: number): Map<number, number> | null {
  const [counts, setCounts] = useState<Map<number, number> | null>(() => (cache && cache.key === refresh ? cache.counts : null));
  useEffect(() => {
    if (!isNativeMediaLibraryAvailable()) { setCounts(new Map()); return; }
    if (cache && cache.key === refresh && Date.now() - cache.at < CACHE_MS) { setCounts(cache.counts); return; }
    let alive = true;
    void (async () => {
      const range = await readGalleryDateRange();
      if (!range.granted || range.earliestMs === undefined) { if (alive) setCounts(new Map()); return; }
      const out = new Map<number, number>();
      // „De la începutul lunii încoace”, apoi diferențe: un apel pe lună.
      let start = monthStart(Date.now());
      const oldest = monthStart(range.earliestMs);
      let after = 0;
      for (let i = 0; i < 36 && start >= oldest; i++) {
        const since = await countGalleryPhotosSince(start);
        out.set(start, Math.max(0, since.count - after));
        after = since.count;
        start = monthStart(start - 1);
      }
      cache = { key: refresh, at: Date.now(), counts: out };
      if (alive) setCounts(out);
    })().catch(() => { if (alive) setCounts(new Map()); });
    return () => { alive = false; };
  }, [refresh]);
  return counts;
}
