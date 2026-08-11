import type { PhotoView } from './store';

const RECAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RECAP_MAX_PHOTOS = 40;

/**
 * "Recap lunar" (plan modernizare) — cele mai bune poze din ultimele 30 de
 * zile, pentru un rulaj rapid in modul Prezentare care exista deja (Ken Burns,
 * avans automat). Nu adauga logica noua de "cea mai buna poza" — refoloseste
 * strict scorul AI deja calculat. Exclude explicit pozele respinse (un recap
 * "cele mai bune momente" n-are ce cauta cu ele) si limiteaza la
 * RECAP_MAX_PHOTOS, ca un recap sa ramana scurt, nu un rulaj al intregii luni.
 */
export function selectMonthlyRecap(photos: PhotoView[], now: Date = new Date(), maxCount = RECAP_MAX_PHOTOS): PhotoView[] {
  const cutoff = now.getTime() - RECAP_WINDOW_MS;
  return photos
    .filter(p => p.capturedAt !== undefined && p.capturedAt >= cutoff && p.status !== 'rejected')
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, maxCount);
}
