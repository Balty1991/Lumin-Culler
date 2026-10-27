/**
 * core/seriesVerdict.ts
 * Dintr-o serie rămâne o singură poză: cea cu scorul cel mai mare.
 *
 * Raportat pe telefon: patru poze aproape identice cu fetița în curte și două
 * selfie-uri identice, toate păstrate; din seria de sub copac, trei păstrate și
 * respinsă tocmai cea cu 93. Gruparea doar retrogada la „de verificat” ce era
 * păstrat și nu-l urca niciodată pe cel mai bun, iar „cel mai bun” se alegea
 * după o ierarhie de criterii, nu după scorul pe care îl vede omul.
 *
 * Regula de acum, pe pozele hotărâte de motor (nu atinge ce a decis omul):
 * - cea cu scorul cel mai mare e păstrată (sau de verificat, dacă scorul ei e
 *   sub pragul de respingere: nu se aruncă tot momentul, dar nici nu se laudă);
 * - celelalte sunt respinse.
 * Egalitățile se rup după alegerea grupării (`preferredId`), apoi după id.
 * Documentele și capturile nu intră în serii (vezi asideOf).
 *
 * Fără dependințe de DB: primește membri, întoarce statusurile noi.
 */
import type { PhotoStatus } from './db';

export interface SeriesMember {
  id: string;
  score: number;
  status: PhotoStatus;
  /** false = l-a decis omul; nu se schimbă. Absent = motorul. */
  aiDecided?: boolean;
}

export interface SeriesOutcome {
  keepId: string;
  /** Doar membrii al căror status se schimbă. */
  changes: Map<string, PhotoStatus>;
}

export function seriesVerdict(
  members: readonly SeriesMember[],
  thresholds: { reject: number },
  preferredId?: string
): SeriesOutcome | null {
  if (members.length < 2) return null;
  const ranked = [...members].sort((a, b) =>
    b.score - a.score
    || (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const keep = ranked[0];
  const changes = new Map<string, PhotoStatus>();
  for (const m of members) {
    if (m.aiDecided === false) continue;
    const next: PhotoStatus = m.id === keep.id
      ? (m.score > thresholds.reject ? 'selected' : 'review')
      : 'rejected';
    if (next !== m.status) changes.set(m.id, next);
  }
  return { keepId: keep.id, changes };
}
