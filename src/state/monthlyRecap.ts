import type { PhotoView } from './store';

const RECAP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Plafon absolut: un recap ramane ceva ce te uiti la el, nu un rulaj al intregii luni. */
const RECAP_MAX_PHOTOS = 40;
/**
 * Cat de mult din ce ai adus poate intra intr-un "cele mai bune": o treime.
 *
 * Observatie a utilizatorului: "cele mai bune poze, a pus tot ce am incarcat".
 * Chiar asa era — singurele filtre erau data si statusul, deci daca importai 32
 * de poze recente si nerespinse, recapul avea exact 32 de poze. Un "cele mai
 * bune" care include TOT nu alege nimic, si asta nu e o chestiune de plafon, ci
 * de definitie: o selectie trebuie sa lase ceva pe dinafara.
 */
const RECAP_MAX_FRACTION = 1 / 3;
/** Sub atatea poze n-are sens sa mai imparti la trei — treci de la selectie la firimituri. */
const RECAP_MIN_PHOTOS = 5;

/**
 * "Cele mai bune din ultimele 30 de zile" — pentru un rulaj rapid in modul
 * Prezentare care exista deja (Ken Burns, avans automat). Nu adauga logica noua
 * de "cea mai buna poza": refoloseste strict scorul AI deja calculat.
 *
 * Trei limite, in ordine: doar ultimele 30 de zile dupa data capturii, fara
 * pozele respinse (un "cele mai bune momente" n-are ce cauta cu ele), si cel
 * mult o treime din cate au ramas — vezi RECAP_MAX_FRACTION pentru de ce
 * fractiunea conteaza mai mult decat plafonul.
 */
export function selectMonthlyRecap(photos: PhotoView[], now: Date = new Date(), maxCount = RECAP_MAX_PHOTOS): PhotoView[] {
  const cutoff = now.getTime() - RECAP_WINDOW_MS;
  const eligible = photos
    .filter(p => p.capturedAt !== undefined && p.capturedAt >= cutoff && p.status !== 'rejected')
    .sort((a, b) => b.aiScore - a.aiScore);
  // Cu putine poze eligibile, fractiunea ar taia pana la 1-2 poze; atunci
  // pastram tot ce e (recapul oricum nu se arata sub un prag — vezi
  // RECAP_TEASER_MIN_PHOTOS in ui/HomeDashboard.tsx).
  const limit = eligible.length <= RECAP_MIN_PHOTOS
    ? eligible.length
    : Math.max(RECAP_MIN_PHOTOS, Math.ceil(eligible.length * RECAP_MAX_FRACTION));
  return eligible.slice(0, Math.min(limit, maxCount));
}
