/**
 * core/reverseGeocode.ts
 * Numele locurilor pentru coordonate — "Roșiori de Vede, România", nu
 * "44.114, 24.987".
 *
 * Cerinta directa a utilizatorului: ecranul Locatii sa arate localitatea, ca in
 * Galeria telefonului.
 *
 * DE UNDE VINE NUMELE, si de ce conteaza: din serviciul de geocodare AL
 * SISTEMULUI (android.location.Geocoder — vezi MediaLibraryPlugin.kt), acelasi
 * pe care il foloseste si Galeria. Pe telefoanele cu servicii Google inseamna o
 * interogare catre serverele lor. E singurul loc din aplicatie, in afara
 * linkului de harta din panoul de informatii, in care ceva pleaca de pe telefon
 * — si pleaca DOAR o pereche de coordonate, niciodata poza. Declarat ca atare
 * in politica de confidentialitate.
 *
 * De aceea numele odata aflat se TINE MINTE local, pe loc, nu pe poza: 300 de
 * poze din acelasi oras inseamna o singura intrebare, o singura data, iar dupa
 * aceea numele apare si fara retea.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface ReverseGeocodePluginApi {
  reverseGeocode(options: { points: { key: string; latitude: number; longitude: number }[] }):
    Promise<{ places: { key: string; label: string }[] }>;
}

const MediaLibraryNative = registerPlugin<ReverseGeocodePluginApi>('MediaLibrary');

const CACHE_KEY = 'lumin-place-names';
/**
 * Cate zecimale are cheia din memorie. 2 zecimale inseamna ~1 km — destul de
 * fin cat sa nu amestece doua localitati vecine, destul de grosier cat doua
 * grupuri din acelasi oras sa nimereasca aceeasi intrare.
 */
const CACHE_PRECISION = 2;
/** Peste atatea locuri retinute, cele mai vechi ies — o biblioteca mare n-are voie sa umfle localStorage la nesfarsit. */
const MAX_CACHED_PLACES = 500;

export function placeCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(CACHE_PRECISION)},${longitude.toFixed(CACHE_PRECISION)}`;
}

type PlaceCache = Record<string, string>;

function readCache(): PlaceCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PlaceCache = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCache(cache: PlaceCache): void {
  try {
    const entries = Object.entries(cache).slice(-MAX_CACHED_PLACES);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Fara localStorage (mod privat, cota plina) numele se cer din nou data
    // viitoare — neplacut, dar nu o eroare.
  }
}

export interface GeocodePoint {
  /** Identificatorul apelantului pentru punctul asta (ex. cheia grupei de locatie). */
  key: string;
  latitude: number;
  longitude: number;
}

/**
 * Numele locurilor pentru punctele date, ca harta cheie -> nume.
 *
 * Intoarce DOAR ce se stie: punctele fara raspuns (fara retea, fara serviciu de
 * geocodare, mijlocul oceanului) lipsesc pur si simplu din harta, iar apelantul
 * ramane pe eticheta lui de rezerva. Nu arunca niciodata — un nume de loc e un
 * lux, nu o conditie de functionare.
 */
export async function resolvePlaceNames(points: GeocodePoint[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!points.length) return names;

  const cache = readCache();
  const missing: GeocodePoint[] = [];
  for (const point of points) {
    const cached = cache[placeCacheKey(point.latitude, point.longitude)];
    if (cached) names.set(point.key, cached);
    else missing.push(point);
  }
  if (!missing.length) return names;
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MediaLibrary')) return names;

  try {
    const result = await MediaLibraryNative.reverseGeocode({ points: missing });
    if (!result.places.length) return names;
    const byKey = new Map(missing.map(p => [p.key, p]));
    for (const place of result.places) {
      const point = byKey.get(place.key);
      if (!point || !place.label) continue;
      names.set(place.key, place.label);
      cache[placeCacheKey(point.latitude, point.longitude)] = place.label;
    }
    writeCache(cache);
  } catch (err) {
    console.warn('Nu am putut afla numele locurilor:', err);
  }
  return names;
}
