/**
 * core/previewUrlCache.ts
 * Cache LRU de Object URL-uri pentru preview-uri (2048px, standard Lightroom
 * — vezi importPipeline.ts). Fara acest cache, fiecare navigare inainte/inapoi
 * intre poze (Workspace loupe, DetailView, GroupCompare) crea un URL nou
 * pentru ACELEASI bytes deja vazute putin mai devreme, fortand browserul sa
 * redecodeze imaginea de la zero de fiecare data cand utilizatorul revine la
 * o poza deja vizitata — un tipar FOARTE comun la triaj (compari doua cadre
 * inainte-inapoi de cateva ori inainte sa decizi care e mai clar). Reutilizand
 * acelasi blob: URL (nu doar acelasi Blob), browserul poate refolosi
 * decodarea deja facuta pentru acel URL specific, in loc sa trateze un URL
 * nou ca pe o resursa complet diferita.
 */
import { Capacitor } from '@capacitor/core';
import { db } from './db';

const MAX_CACHED = 40;
/** photoId -> object URL. Un Map obisnuit pastreaza ordinea de INSERARE, pe care o folosim ca ordine LRU (vezi "atingerea" din getCachedPreviewUrl). */
const cache = new Map<string, string>();

/**
 * Intoarce URL-ul (cache-uit sau proaspat creat) pentru preview-ul unei poze,
 * cu fallback la miniatura (poze fara preview, importate cu o versiune mai
 * veche a aplicatiei). Null daca poza n-are nici preview, nici miniatura.
 */
export async function getCachedPreviewUrl(photoId: string): Promise<string | null> {
  const existing = cache.get(photoId);
  if (existing) {
    // "atinge" intrarea — o mutam la finalul Map-ului (cea mai recent folosita), ca eviction-ul sa nu o aleaga prea curand
    cache.delete(photoId);
    cache.set(photoId, existing);
    return existing;
  }

  const rec = (await db.previews.get(photoId)) ?? (await db.thumbnails.get(photoId));
  if (!rec) return null;

  // dubla verificare: cat a durat citirea din Dexie de mai sus, un alt apel
  // concurent (ex. navigare rapida inainte-inapoi) ar fi putut deja popula cache-ul
  const raced = cache.get(photoId);
  if (raced) return raced;

  const url = URL.createObjectURL(rec.blob);
  cache.set(photoId, url);
  if (cache.size > MAX_CACHED) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestUrl = cache.get(oldestKey)!;
      cache.delete(oldestKey);
      URL.revokeObjectURL(oldestUrl);
    }
  }
  return url;
}

/**
 * Uita O SINGURA poza, fiindca imaginea din spate s-a schimbat. Perechea lui
 * forgetThumbUrl — vezi acolo pentru de ce e nevoie: un Object URL tine
 * bytes-ii de la momentul crearii, nu inregistrarea din baza de date.
 */
export function forgetPreviewUrl(photoId: string): void {
  const url = cache.get(photoId);
  if (!url) return;
  cache.delete(photoId);
  URL.revokeObjectURL(url);
}

/** Goleste tot cache-ul si revoca toate URL-urile — apelat la "Goleste sesiunea"/clear all (state/store.ts), ca sa nu ramana URL-uri orfane pentru o biblioteca deja stearsa. */
export function clearPreviewUrlCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

/**
 * Ce se arată pe tot ecranul: poza ORIGINALĂ din galerie, când se poate.
 *
 * Raportat: în vizualizare pozele păreau mai mici și neclare la zoom. Treapta
 * 1 (StageOnePlugin.kt) păstrează un preview de doar 480 px, destul pentru
 * analiză și grilă, nu pentru ecranul plin. Pe telefon originalul e deja pe
 * disc, iar WebView-ul îl poate citi direct prin URI (fără copie și fără MB în
 * baza de date). Formatele pe care WebView-ul nu le decodează (HEIC, RAW) și
 * pozele fără URI (web, import din fișier) rămân pe preview-ul salvat.
 */
export async function getDisplayUrl(photoId: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const photo = await db.photos.get(photoId);
      if (photo?.mediaUri && /\.(jpe?g|png|webp)$/i.test(photo.fileName)) {
        return Capacitor.convertFileSrc(photo.mediaUri);
      }
    } catch {
      // baza indisponibilă: preview-ul de mai jos
    }
  }
  return getCachedPreviewUrl(photoId);
}
