import { useEffect, useState } from 'react';
import { countryName, findNearestPlace, getLoadedPlaceIndex, loadPlaceIndex, type PlaceIndex } from '../core/placeNames';
import type { AlbumPhoto, MomentAlbum } from './momentAlbums';

/**
 * lumin/tripPlaces.ts
 * Vacanțele cu numele locului: „Vacanță · Grecia” (altă țară) sau „Vacanță ·
 * Sinaia” (acasă, în țară), din coordonatele pe care camera le-a scris în poze
 * și lista de localități din aplicație. Nimic nu pleacă de pe telefon.
 */
interface GeoPhoto { gpsLatitude?: number; gpsLongitude?: number }

/** Ce loc apare cel mai des în poze: localitatea și țara (null fără coordonate). */
export function mainPlace(index: PlaceIndex, photos: readonly GeoPhoto[]): { name: string; country: string } | null {
  const counts = new Map<string, { name: string; country: string; n: number }>();
  for (const p of photos) {
    if (p.gpsLatitude === undefined || p.gpsLongitude === undefined || (p.gpsLatitude === 0 && p.gpsLongitude === 0)) continue;
    const place = findNearestPlace(index, p.gpsLatitude, p.gpsLongitude);
    if (!place) continue;
    const key = `${place.country}|${place.name}`;
    const c = counts.get(key) ?? { name: place.name, country: place.country, n: 0 };
    c.n++;
    counts.set(key, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { name: best.name, country: best.country } : null;
}

/** Țara în care sunt cele mai multe poze: „acasă”. */
export function homeCountry(index: PlaceIndex, photos: readonly GeoPhoto[]): string | null {
  const counts = new Map<string, number>();
  let seen = 0;
  for (const p of photos) {
    if (p.gpsLatitude === undefined || p.gpsLongitude === undefined) continue;
    if (++seen > 400) break; // destul pentru o majoritate
    const place = findNearestPlace(index, p.gpsLatitude, p.gpsLongitude);
    if (place) counts.set(place.country, (counts.get(place.country) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Vacanțele primesc locul în titlu; restul evenimentelor rămân cum sunt. */
export function useTripPlaces<P extends GeoPhoto & AlbumPhoto>(events: MomentAlbum<P>[], all: readonly P[], locale: string): MomentAlbum<P>[] {
  const [index, setIndex] = useState<PlaceIndex | null>(getLoadedPlaceIndex);
  useEffect(() => {
    if (index || !events.some(e => e.kind === 'trip')) return;
    let alive = true;
    void loadPlaceIndex().then(i => { if (alive) setIndex(i); });
    return () => { alive = false; };
  }, [index, events]);
  if (!index) return events;
  const home = homeCountry(index, all);
  return events.map(e => {
    if (e.kind !== 'trip') return e;
    const place = mainPlace(index, e.photos);
    if (!place) return e;
    const label = place.country !== home ? countryName(place.country, locale) || place.name : place.name;
    const prefix = locale === 'en' ? 'Trip' : 'Vacanță';
    return { ...e, title: `${prefix} · ${label} · ${(e.title ?? '').split(' · ').slice(1).join(' · ')}`.replace(/ · $/, '') };
  });
}
