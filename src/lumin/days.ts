/**
 * lumin/days.ts
 * Galeria privită ca zile și serii: unitatea firească pentru cine face 20–40
 * de poze pe zi. Fără React, ca să se poată testa.
 */
import { startOfDay } from '../core/todayDigest';

export interface DayPhoto {
  id: string;
  capturedAt?: number;
  importedAt: number;
  status: string;
  aiScore: number;
  groupId?: string;
  aside?: string;
}

export interface Series<P extends DayPhoto = DayPhoto> {
  id: string;
  photos: P[];
  /** Cadrul ales: cel păstrat de om, altfel cel cu scorul cel mai mare. */
  best: P;
}

export interface Day<P extends DayPhoto = DayPhoto> {
  start: number;
  photos: P[];
  kept: P[];
  waiting: P[];
  rejected: P[];
  aside: P[];
  series: Series<P>[];
}

export function photoTime(p: DayPhoto): number {
  return p.capturedAt ?? p.importedAt;
}

export function groupDays<P extends DayPhoto>(photos: readonly P[]): Day<P>[] {
  const byDay = new Map<number, P[]>();
  for (const p of photos) {
    const d = startOfDay(photoTime(p));
    const list = byDay.get(d);
    if (list) list.push(p); else byDay.set(d, [p]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([start, list]) => {
      const sorted = [...list].sort((a, b) => photoTime(a) - photoTime(b));
      const memories = sorted.filter(p => !p.aside);
      const groups = new Map<string, P[]>();
      for (const p of memories) {
        if (!p.groupId) continue;
        const g = groups.get(p.groupId);
        if (g) g.push(p); else groups.set(p.groupId, [p]);
      }
      const series: Series<P>[] = [...groups.entries()]
        .filter(([, g]) => g.length >= 2)
        .map(([id, g]) => ({
          id,
          photos: g,
          best: g.find(p => p.status === 'selected') ?? [...g].sort((a, b) => b.aiScore - a.aiScore)[0]
        }));
      return {
        start,
        photos: sorted,
        kept: memories.filter(p => p.status === 'selected').sort((a, b) => b.aiScore - a.aiScore),
        waiting: memories.filter(p => p.status === 'review' || p.status === 'pending' || p.status === 'candidate'),
        rejected: memories.filter(p => p.status === 'rejected'),
        aside: sorted.filter(p => !!p.aside),
        series
      };
    });
}
