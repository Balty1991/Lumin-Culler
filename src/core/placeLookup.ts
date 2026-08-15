/**
 * core/placeLookup.ts
 * De unde vine numele unui loc: din lista inclusa in aplicatie, sau de la
 * serviciul de harti al telefonului — alegerea utilizatorului.
 *
 * Sunt doua lucruri diferite, si niciunul nu e "mai bun" in general:
 *
 *   OFFLINE (implicit): o lista de localitati inclusa in pachet
 *   (core/placeNames.ts). Nu pleaca nimic, nici macar coordonatele, si
 *   functioneaza in avion. In schimb da doar localitatea, iar asezarile mici
 *   lipsesc — pentru ele scrie "langa X".
 *
 *   ONLINE (optional, pornit de utilizator din meniu): serviciul de geocodare
 *   al sistemului, acelasi pe care il foloseste Galeria telefonului. Da adresa
 *   completa, cu strada si numarul. In schimb pleaca de pe telefon o pereche de
 *   coordonate pentru fiecare loc — niciodata pozele, niciun alt fel de date.
 *
 * Implicit e OFFLINE, deliberat: o aplicatie care promite ca nu trimite nimic
 * n-are voie sa inceapa sa trimita pentru cine n-a citit niciodata setarile.
 * Cine vrea adrese exacte le porneste, stiind ce da la schimb — scrie chiar pe
 * optiune.
 *
 * Modul online nu inlocuieste lista, o completeaza: fara retea sau pe telefoane
 * fara serviciu de geocodare, raspunsul vine tot din lista offline, deci
 * ecranul arata un nume in loc de un gol.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { findNearestPlace, formatPlace, loadPlaceIndex } from './placeNames';

interface ReverseGeocodePluginApi {
  reverseGeocode(options: { points: { key: string; latitude: number; longitude: number }[] }):
    Promise<{ places: { key: string; label: string; locality?: string }[] }>;
}

/**
 * Cat de precisa sa fie eticheta ceruta.
 *
 * 'address' pentru O poza anume: adresa completa e exact ce vrei acolo.
 * 'locality' pentru un GRUP de poze: grupul acopera mai multe strazi, iar
 * eticheta lui se calculeaza pe centrul grupului — un punct pe care nu s-a
 * facut nicio poza. Observatie a utilizatorului, cu captura: grupul scria
 * "Strada Renasterii 78", dar pozele din el erau de pe alte strazi. Localitatea
 * e adevarata pentru toate pozele din grup.
 */
export type PlacePrecision = 'address' | 'locality';

const MediaLibraryNative = registerPlugin<ReverseGeocodePluginApi>('MediaLibrary');

const ONLINE_KEY = 'lumin-place-names-online';
/** v2: intrarile tin acum si adresa, si localitatea, nu un singur text. */
const CACHE_KEY = 'lumin-place-names-v2';
/** Zecimalele cheii din memorie: 2 inseamna ~1 km, deci doua poze din acelasi oras nimeresc aceeasi intrare. */
const CACHE_PRECISION = 2;
/** Peste atatea adrese retinute, cele mai vechi ies — o biblioteca mare n-are voie sa umfle localStorage la nesfarsit. */
const MAX_CACHED_PLACES = 500;

/** Adresele exacte (online) sunt PORNITE de utilizator; implicit, totul ramane pe telefon. */
export function readOnlinePlaceNames(): boolean {
  try {
    return localStorage.getItem(ONLINE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOnlinePlaceNames(on: boolean): void {
  try { localStorage.setItem(ONLINE_KEY, on ? '1' : '0'); } catch {
    // stocare indisponibila — preferinta ramane doar pentru sesiunea curenta
  }
}

export function placeCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(CACHE_PRECISION)},${longitude.toFixed(CACHE_PRECISION)}`;
}

/** Ce s-a aflat despre un loc: adresa completa si localitatea din care face parte. */
interface CachedPlace {
  address: string;
  locality: string;
}

function readCache(): Record<string, CachedPlace> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CachedPlace> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const { address, locality } = v as Record<string, unknown>;
      if (typeof address === 'string' && typeof locality === 'string') out[k] = { address, locality };
    }
    return out;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedPlace>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(cache).slice(-MAX_CACHED_PLACES))));
  } catch {
    // vezi writeOnlinePlaceNames
  }
}

/** Sterge adresele retinute — apelata la oprirea modului online, ca ecranul sa nu ramana pe adrese cerute cat era pornit. */
export function forgetCachedAddresses(): void {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* vezi writeCache */ }
}

export interface PlacePoint {
  /** Identificatorul apelantului pentru punctul asta (ex. cheia grupei de locatie). */
  key: string;
  latitude: number;
  longitude: number;
}

/** Numele din lista inclusa in aplicatie, pentru punctele date. Nu iese nimic in retea. */
async function offlineNames(
  points: PlacePoint[],
  locale: string,
  nearLabel: (place: string) => string
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const index = await loadPlaceIndex();
  if (!index) return names;
  for (const point of points) {
    const place = findNearestPlace(index, point.latitude, point.longitude);
    if (place) names.set(point.key, formatPlace(place, locale, nearLabel));
  }
  return names;
}

/**
 * Numele/adresele pentru punctele date, dupa modul ales de utilizator.
 *
 * Intoarce DOAR ce se stie: punctele fara raspuns lipsesc din harta, iar
 * apelantul ramane pe eticheta lui de rezerva. Nu arunca niciodata — un nume de
 * loc e un plus, nu o conditie de functionare.
 */
export async function resolvePlaceLabels(
  points: PlacePoint[],
  locale: string,
  nearLabel: (place: string) => string,
  precision: PlacePrecision = 'address'
): Promise<Map<string, string>> {
  if (!points.length) return new Map();
  // Lista offline stie oricum doar localitati, deci precizia n-are ce schimba.
  if (!readOnlinePlaceNames()) return offlineNames(points, locale, nearLabel);

  // Modul online: intai ce s-a aflat deja (nicio interogare repetata), apoi
  // restul de la serviciul sistemului, si abia la final lista offline pentru ce
  // n-a raspuns — asa ecranul nu ramane gol fara retea.
  const labels = new Map<string, string>();
  const cache = readCache();
  const missing: PlacePoint[] = [];
  for (const point of points) {
    const cached = cache[placeCacheKey(point.latitude, point.longitude)];
    if (cached) labels.set(point.key, precision === 'locality' ? cached.locality : cached.address);
    else missing.push(point);
  }

  if (missing.length && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('MediaLibrary')) {
    try {
      const result = await MediaLibraryNative.reverseGeocode({ points: missing });
      const byKey = new Map(missing.map(p => [p.key, p]));
      for (const place of result.places) {
        const point = byKey.get(place.key);
        if (!point || !place.label) continue;
        // Versiunile mai vechi ale plugin-ului nu trimit `locality` — atunci
        // adresa tine si locul ei, ca ecranul sa nu ramana gol.
        const entry = { address: place.label, locality: place.locality || place.label };
        labels.set(place.key, precision === 'locality' ? entry.locality : entry.address);
        cache[placeCacheKey(point.latitude, point.longitude)] = entry;
      }
      if (result.places.length) writeCache(cache);
    } catch (err) {
      console.warn('Nu am putut afla adresele online:', err);
    }
  }

  const stillMissing = points.filter(p => !labels.has(p.key));
  if (stillMissing.length) {
    for (const [key, label] of await offlineNames(stillMissing, locale, nearLabel)) labels.set(key, label);
  }
  return labels;
}
