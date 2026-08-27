import { db } from './db';

/**
 * core/thumbUrlCache.ts
 * Cache LRU de Object URL-uri pentru MINIATURILE din grila.
 *
 * Fratele lui previewUrlCache.ts, pentru celalalt capat al aplicatiei.
 *
 * SACADAREA LA DERULARE, raportata de utilizator. Grila e virtualizata, deci
 * la derulare cardurile se monteaza si se demonteaza continuu. Fiecare card,
 * la montare, facea:
 *
 *   db.thumbnails.get(id)  ->  URL.createObjectURL(blob)  ->  <img>
 *
 * si la demontare revoca URL-ul. Adica derularea inapoi peste aceleasi poze
 * relua tot drumul de la zero: o citire IndexedDB (asincrona, deci cardul
 * apare gol si se umple dupa) plus o decodare completa a imaginii, fiindca un
 * URL nou e pentru browser o resursa complet noua, chiar daca bytes-ii sunt
 * identici.
 *
 * Cu cache, a doua trecere peste aceeasi zona e instantanee si sincrona: URL-ul
 * exista deja si decodarea lui e deja in memoria browserului.
 *
 * De ce plafonul e mai mare decat la preview-uri: miniaturile sunt de cateva
 * zeci de KB, nu de cativa MB, iar pe ecran incap zeci deodata. 240 acopera
 * cateva ecrane de derulare in ambele sensuri — exact tiparul care doare.
 */
const MAX_CACHED = 240;

/** photoId -> object URL. Map-ul pastreaza ordinea de INSERARE, folosita ca ordine LRU. */
const cache = new Map<string, string>();

/** Sincron: URL-ul deja pregatit, sau null. Cu el, o poza revizitata apare fara nicio pauza. */
export function peekThumbUrl(photoId: string): string | null {
  const existing = cache.get(photoId);
  if (!existing) return null;
  // "atinge" intrarea — o mutam la finalul Map-ului (cea mai recent folosita).
  cache.delete(photoId);
  cache.set(photoId, existing);
  return existing;
}

export async function getCachedThumbUrl(photoId: string): Promise<string | null> {
  const existing = peekThumbUrl(photoId);
  if (existing) return existing;

  const rec = await db.thumbnails.get(photoId);
  if (!rec) return null;

  // Dubla verificare: cat a durat citirea, un alt card (derulare rapida) ar fi
  // putut deja popula cache-ul pentru aceeasi poza.
  const raced = cache.get(photoId);
  if (raced) return raced;

  const url = URL.createObjectURL(rec.blob);
  cache.set(photoId, url);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      const stale = cache.get(oldest);
      cache.delete(oldest);
      if (stale) URL.revokeObjectURL(stale);
    }
  }
  return url;
}

/**
 * Uita O SINGURA poza, fiindca imaginea din spate s-a schimbat.
 *
 * Un Object URL e legat de bytes-ii de la momentul crearii lui, nu de
 * inregistrarea din baza de date. Cand o miniatura e rescrisa (vezi
 * core/bakeEdits.ts, "Aplica editarile"), URL-ul din cache arata mai departe
 * poza VECHE — la fel de valid, si complet gresit. Din afara, omul apasa
 * "Aplica", i se spune ca s-a aplicat, si vede poza neatinsa.
 *
 * De aceea cine rescrie o miniatura trebuie sa cheme si asta.
 */
export function forgetThumbUrl(photoId: string): void {
  const url = cache.get(photoId);
  if (!url) return;
  cache.delete(photoId);
  URL.revokeObjectURL(url);
}

/**
 * Elibereaza tot. De chemat cand pozele dispar de sub cache (golirea sesiunii,
 * stergeri in masa) — altfel URL-urile ar tine in memorie bytes ai unor poze
 * care nu mai exista.
 */
export function clearThumbUrlCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
