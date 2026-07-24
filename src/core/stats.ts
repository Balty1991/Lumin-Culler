/**
 * core/stats.ts
 * "Dashboard de performanta si statistici" din planul de dezvoltare (3.2.3) —
 * agregari pure, fara acces la DOM/Dexie, usor de testat: statusuri, rating-uri,
 * serii si rata de acord AI/utilizator (cat de des a fost de acord decizia
 * manuala cu recomandarea AI — semnal direct al cat de bine "s-a antrenat" deja
 * motorul pentru stilul acestui utilizator).
 */
import type { PhotoView } from '../state/store';
import type { CorrectionRecord, AnalysisRecord } from './db';

export interface LibraryStats {
  total: number;
  selected: number;
  rejected: number;
  review: number;
  pending: number;
  /** numarul de poze cu rating 1..5 — indexul 0 e neutilizat (fara rating). */
  ratingCounts: [number, number, number, number, number, number];
  /** numarul de serii/duplicate distincte (groupId unic). */
  seriesCount: number;
  avgAiScore: number;
}

export function computeLibraryStats(photos: PhotoView[]): LibraryStats {
  const ratingCounts: LibraryStats['ratingCounts'] = [0, 0, 0, 0, 0, 0];
  const groupIds = new Set<string>();
  let selected = 0, rejected = 0, review = 0, pending = 0, scoreSum = 0;

  for (const p of photos) {
    if (p.status === 'selected') selected++;
    else if (p.status === 'rejected') rejected++;
    else if (p.status === 'review') review++;
    else pending++;
    if (p.rating >= 1 && p.rating <= 5) ratingCounts[p.rating]++;
    if (p.groupId) groupIds.add(p.groupId);
    scoreSum += p.aiScore;
  }

  return {
    total: photos.length,
    selected, rejected, review, pending,
    ratingCounts,
    seriesCount: groupIds.size,
    avgAiScore: photos.length ? Math.round(scoreSum / photos.length) : 0
  };
}

export interface AgreementStats {
  /** total de corectii inregistrate (o intrare per decizie manuala Selecteaza/Respinge, cf. ContextEngine.recordCorrection). */
  total: number;
  /** fractiunea (0..1) in care decizia manuala a fost identica cu recomandarea AI la momentul respectiv. */
  agreementRate: number;
}

export function computeAgreementStats(corrections: CorrectionRecord[]): AgreementStats {
  if (!corrections.length) return { total: 0, agreementRate: 0 };
  const agreed = corrections.filter(c => c.aiDecision === c.userDecision).length;
  return { total: corrections.length, agreementRate: agreed / corrections.length };
}

export interface ProjectStats {
  /** cheia de grupare — numele proiectului, sau `noProjectKey` pentru pozele fara proiect ales. */
  key: string;
  /** eticheta afisata — identica cu `key`, in afara de grupul "fara proiect". */
  label: string;
  total: number;
  selected: number;
  rejected: number;
  review: number;
  firstCapturedAt?: number;
  lastCapturedAt?: number;
}

/**
 * "Modulul Proiecte" (plan 3.2.3) — agrega pozele curente dupa PhotoRecord.project
 * (etichetat la import cu numele de sesiune activ, ProjectNameField). Nu e o
 * partitionare reala a bibliotecii (toate pozele traiesc in aceeasi baza) — doar
 * o vizualizare agregata + filtru de tip "arata-mi doar acest proiect".
 */
export function computeProjectStats(photos: PhotoView[], noProjectKey: string): ProjectStats[] {
  const byKey = new Map<string, ProjectStats>();
  for (const p of photos) {
    const key = p.project ?? noProjectKey;
    let s = byKey.get(key);
    if (!s) {
      s = { key, label: p.project ?? 'Fara proiect', total: 0, selected: 0, rejected: 0, review: 0 };
      byKey.set(key, s);
    }
    s.total++;
    if (p.status === 'selected') s.selected++;
    else if (p.status === 'rejected') s.rejected++;
    else if (p.status === 'review') s.review++;
    if (p.capturedAt !== undefined) {
      s.firstCapturedAt = s.firstCapturedAt === undefined ? p.capturedAt : Math.min(s.firstCapturedAt, p.capturedAt);
      s.lastCapturedAt = s.lastCapturedAt === undefined ? p.capturedAt : Math.max(s.lastCapturedAt, p.capturedAt);
    }
  }
  // proiectele cu cele mai multe poze primele; grupul "fara proiect" mereu ultimul
  return Array.from(byKey.values()).sort((a, b) =>
    a.key === noProjectKey ? 1 : b.key === noProjectKey ? -1 : b.total - a.total
  );
}

export interface PersonRecognitionStats {
  /** de cate ori a fost recunoscuta aceasta persoana (fete individuale, nu poze — o poza cu 2 fete ale aceleiasi persoane numara 2). */
  matchCount: number;
  /** similaritate cosinus medie (0..1) a acelor potriviri fata de pragul de recunoastere. */
  avgSimilarity: number;
}

/**
 * "Feedback Vizual: confidence score pentru recunoasterea fiecarei persoane"
 * (plan 3.2.3, PersonsPanel) — agregat din toate fetele deja analizate din
 * biblioteca curenta (AnalysisRecord.faces[].personId/similarity), nu doar din
 * pozele de referinta ale inrolarii. O medie scazuta sau un numar mic de
 * potriviri sugereaza ca profilul ar beneficia de mai multe poze de referinta.
 */
export function computePersonRecognitionStats(analyses: AnalysisRecord[]): Map<string, PersonRecognitionStats> {
  const sums = new Map<string, { count: number; sum: number }>();
  for (const a of analyses) {
    for (const f of a.faces) {
      if (!f.personId) continue;
      const s = sums.get(f.personId) ?? { count: 0, sum: 0 };
      s.count++;
      s.sum += f.similarity;
      sums.set(f.personId, s);
    }
  }
  const result = new Map<string, PersonRecognitionStats>();
  for (const [id, s] of sums) result.set(id, { matchCount: s.count, avgSimilarity: s.sum / s.count });
  return result;
}
