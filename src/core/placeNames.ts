/**
 * core/placeNames.ts
 * Numele localitatilor pentru coordonate — "Roșiori de Vede, România" in loc de
 * "44.114, 24.987" — calculat INTEGRAL PE TELEFON.
 *
 * Cerinta directa a utilizatorului, in doi pasi: intai "sa foloseasca orasele
 * sau localitatile, nu codul GPS", apoi, pus in fata alegerii, "sa nu plece
 * nimic deloc". Prima varianta intreba serviciul de geocodare al sistemului
 * (adica, pe telefoanele cu servicii Google, serverele lor); asta a fost
 * inlocuit cu o lista de localitati inclusa in aplicatie.
 *
 * Ce se pierde fata de geocodarea online, spus pe fata: nu exista adresa
 * (strada si numarul), si localitatile sub ~1000 de locuitori lipsesc din
 * lista. Pentru ele se arata cea mai apropiata localitate cunoscuta, marcata
 * ca atare ("langa X"), nu un nume gresit prezentat drept sigur.
 *
 * Lista vine de la GeoNames (cities1000, CC BY 4.0) si e generata la build de
 * CI, ca modelele AI — vezi pasul "Bundle place names" din .github/workflows.
 * Cand fisierul lipseste (build local fara pasul acela), totul functioneaza
 * mai departe fara nume, pe eticheta cu distanta si coordonate.
 */

/** Sub atat, poza e considerata IN localitate. */
const IN_PLACE_KM = 5;
/** Peste atat, nici macar "langa" n-ar mai fi adevarat — camp deschis, munte, larg. */
const NEAR_PLACE_KM = 30;
const EARTH_RADIUS_KM = 6371;

export interface PlaceIndex {
  names: string[];
  countries: string[];
  latitudes: Float64Array;
  longitudes: Float64Array;
}

export interface NearestPlace {
  name: string;
  /** Codul de tara din lista (ex. "RO") — numele tarii se traduce la afisare. */
  country: string;
  distanceKm: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fisierul are un rand per localitate: nume, latitudine, longitudine, tara,
 * separate de TAB (formatul GeoNames, din care CI pastreaza doar aceste patru
 * coloane). Randurile stricate se sar in tacere — o lista de 150.000 de randuri
 * n-are voie sa pice toata din cauza unuia.
 */
export function parsePlaceIndex(text: string): PlaceIndex {
  const names: string[] = [];
  const countries: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    names.push(parts[0]);
    lats.push(lat);
    lons.push(lon);
    countries.push(parts[3].trim());
  }
  return {
    names,
    countries,
    latitudes: Float64Array.from(lats),
    longitudes: Float64Array.from(lons)
  };
}

/**
 * Cea mai apropiata localitate din lista, sau null daca nu e niciuna destul de
 * aproape.
 *
 * Cautarea e liniara peste toata lista. Pare brutal, dar sunt cateva sute de
 * mii de comparatii aritmetice simple, adica milisecunde, si se face de cateva
 * ori pe ecran — o structura spatiala ar fi mai mult cod de intretinut decat
 * timp castigat. Prima trecere compara patrate de grade (fara radacini, fara
 * trigonometrie), si abia castigatorul primeste distanta reala in km.
 */
export function findNearestPlace(index: PlaceIndex, latitude: number, longitude: number): NearestPlace | null {
  let bestIndex = -1;
  let bestScore = Infinity;
  // Longitudinea se stramteaza spre poli; fara corectia asta, la 45 de grade
  // latitudine o diferenta de longitudine ar parea cu ~40% mai mare decat e.
  const lonScale = Math.cos(toRad(latitude));
  for (let i = 0; i < index.latitudes.length; i++) {
    const dLat = index.latitudes[i] - latitude;
    const dLon = (index.longitudes[i] - longitude) * lonScale;
    const score = dLat * dLat + dLon * dLon;
    if (score < bestScore) { bestScore = score; bestIndex = i; }
  }
  if (bestIndex < 0) return null;
  const distanceKm = haversineKm(latitude, longitude, index.latitudes[bestIndex], index.longitudes[bestIndex]);
  if (distanceKm > NEAR_PLACE_KM) return null;
  return { name: index.names[bestIndex], country: index.countries[bestIndex], distanceKm };
}

/**
 * Numele tarii in limba interfetei, din codul ISO — traducerea o face motorul
 * (Intl), nu o lista tinuta de noi in 85 de limbi.
 *
 * `fallback: 'code'` ca un cod pe care motorul nu-l cunoaste sa ramana cod
 * ("XK"), nu sa dispara.
 */
function countryName(code: string, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Eticheta gata de afisat. `nearLabel` primeste numele deja compus si intoarce
 * forma "langa X" — traducerea traieste in i18n, nu aici.
 */
export function formatPlace(
  place: NearestPlace,
  locale: string,
  nearLabel: (placeName: string) => string
): string {
  const country = countryName(place.country, locale);
  const full = country ? `${place.name}, ${country}` : place.name;
  return place.distanceKm <= IN_PLACE_KM ? full : nearLabel(full);
}

/**
 * Lista, incarcata o singura data si tinuta in memorie. `null` inseamna "am
 * incercat si nu exista" — nu se mai reincearca la fiecare deschidere de ecran.
 */
let indexPromise: Promise<PlaceIndex | null> | null = null;

export function loadPlaceIndex(): Promise<PlaceIndex | null> {
  indexPromise ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}places/cities.tsv`);
      if (!response.ok) return null;
      return parsePlaceIndex(await response.text());
    } catch {
      // Build local fara pasul de CI care genereaza lista: ecranele raman pe
      // distanta si coordonate, fara nicio eroare vizibila.
      return null;
    }
  })();
  return indexPromise;
}
