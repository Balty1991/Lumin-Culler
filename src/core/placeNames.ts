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
 * (strada si numarul), si asezarile sub ~500 de locuitori care nu sunt resedinta
 * de comuna lipsesc din lista. Pentru ele se arata cea mai apropiata localitate
 * cunoscuta, marcata ca atare ("langa X"), nu un nume gresit prezentat drept
 * sigur.
 *
 * Lista e MONDIALA (toate tarile, ~200.000 de localitati), nu doar Romania —
 * vine de la GeoNames (cities500, CC BY 4.0) si e generata la build de CI, ca
 * modelele AI; vezi pasul "Bundle place names" din .github/workflows. Cand
 * fisierul lipseste (build local fara pasul acela), totul functioneaza mai
 * departe fara nume, pe eticheta cu distanta si coordonate.
 */

/** Peste atat, nici macar "langa" n-ar mai fi adevarat — camp deschis, munte, larg. */
const NEAR_PLACE_KM = 30;
const EARTH_RADIUS_KM = 6371;
/**
 * Cel mai mic numar de km intr-un grad de latitudine (la ecuator). Folosit ca sa
 * transformam NEAR_PLACE_KM intr-o banda de latitudini care sigur nu taie nimic.
 */
const KM_PER_DEGREE_LAT = 110.574;

/**
 * Cat de departe de punctul din lista mai zicem ca poza e IN localitate.
 *
 * Un prag fix era gresit in ambele sensuri: 5 km inghit un catun intreg si tot
 * campul din jurul lui, dar nu ajung nici pana la marginea unui oras mare, al
 * carui punct din lista e centrul. Asa ca raza creste cu radacina populatiei —
 * populatia e o suprafata, raza e radacina ei.
 */
const PLACE_RADIUS_SCALE_KM = 0.6;
const MIN_IN_PLACE_KM = 1.5;
const MAX_IN_PLACE_KM = 12;
/** Cand randul are coloana de populatie, dar scrie 0 (resedinte fara cifra la GeoNames). */
const UNKNOWN_POP_IN_PLACE_KM = 3;
/** Cand lista n-are deloc coloana de populatie (fisier vechi, 4 coloane). */
const NO_POP_COLUMN_IN_PLACE_KM = 5;

export interface PlaceIndex {
  names: string[];
  countries: string[];
  /** Sortate crescator — cautarea taie o banda de latitudini, nu toata lista. */
  latitudes: Float64Array;
  longitudes: Float64Array;
  /** 0 = necunoscuta. Gol cand fisierul n-are coloana a cincea. */
  populations: Int32Array;
  hasPopulations: boolean;
}

export interface NearestPlace {
  name: string;
  /** Codul de tara din lista (ex. "RO") — numele tarii se traduce la afisare. */
  country: string;
  distanceKm: number;
  /** Sub atat, poza e considerata IN localitate; peste, se scrie "langa". */
  inPlaceRadiusKm: number;
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

function inPlaceRadiusKm(population: number, hasPopulations: boolean): number {
  if (!hasPopulations) return NO_POP_COLUMN_IN_PLACE_KM;
  if (population <= 0) return UNKNOWN_POP_IN_PLACE_KM;
  const raw = PLACE_RADIUS_SCALE_KM * Math.sqrt(population / 1000);
  return Math.min(MAX_IN_PLACE_KM, Math.max(MIN_IN_PLACE_KM, raw));
}

/**
 * Fisierul are un rand per localitate: nume, latitudine, longitudine, tara,
 * populatie — separate de TAB (formatul GeoNames, din care CI pastreaza doar
 * aceste cinci coloane). Populatia e optionala, ca un fisier vechi de patru
 * coloane sa nu strice nimic. Randurile stricate se sar in tacere — o lista de
 * 200.000 de randuri n-are voie sa pice toata din cauza unuia.
 *
 * La final lista se sorteaza dupa latitudine: cautarea foloseste asta ca sa
 * compare doar localitatile de pe aceeasi fasie a globului, nu toate.
 */
export function parsePlaceIndex(text: string): PlaceIndex {
  const names: string[] = [];
  const countries: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  const pops: number[] = [];
  let hasPopulations = false;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let population = 0;
    if (parts.length >= 5) {
      hasPopulations = true;
      const parsed = Number(parts[4]);
      if (Number.isFinite(parsed) && parsed > 0) population = Math.round(parsed);
    }
    names.push(parts[0]);
    lats.push(lat);
    lons.push(lon);
    countries.push(parts[3].trim());
    pops.push(population);
  }

  const order = lats.map((_, i) => i).sort((a, b) => lats[a] - lats[b]);
  return {
    names: order.map(i => names[i]),
    countries: order.map(i => countries[i]),
    latitudes: Float64Array.from(order, i => lats[i]),
    longitudes: Float64Array.from(order, i => lons[i]),
    populations: Int32Array.from(order, i => pops[i]),
    hasPopulations
  };
}

/** Primul indice cu latitudine >= `target`, in lista sortata. */
function lowerBound(latitudes: Float64Array, target: number): number {
  let lo = 0;
  let hi = latitudes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (latitudes[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Cea mai apropiata localitate din lista, sau null daca nu e niciuna destul de
 * aproape.
 *
 * Se compara doar localitatile aflate in banda de latitudini care poate contine
 * ceva la mai putin de NEAR_PLACE_KM — restul globului e taiat din doua cautari
 * binare, nu parcurs. Fara asta, o lista mondiala de 200.000 de randuri ori
 * cateva sute de poze inseamna zeci de milioane de comparatii la fiecare
 * deschidere de ecran. In banda, prima trecere compara patrate de grade (fara
 * radacini, fara trigonometrie), si abia castigatorul primeste distanta reala.
 */
export function findNearestPlace(index: PlaceIndex, latitude: number, longitude: number): NearestPlace | null {
  const bandDeg = NEAR_PLACE_KM / KM_PER_DEGREE_LAT;
  const from = lowerBound(index.latitudes, latitude - bandDeg);
  const to = lowerBound(index.latitudes, latitude + bandDeg);
  let bestIndex = -1;
  let bestScore = Infinity;
  // Longitudinea se stramteaza spre poli; fara corectia asta, la 45 de grade
  // latitudine o diferenta de longitudine ar parea cu ~40% mai mare decat e.
  const lonScale = Math.cos(toRad(latitude));
  for (let i = from; i < to; i++) {
    const dLat = index.latitudes[i] - latitude;
    let dLon = index.longitudes[i] - longitude;
    // Antimeridianul: -179 si +179 sunt vecine, nu la 358 de grade distanta.
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    dLon *= lonScale;
    const score = dLat * dLat + dLon * dLon;
    if (score < bestScore) { bestScore = score; bestIndex = i; }
  }
  if (bestIndex < 0) return null;
  const distanceKm = haversineKm(latitude, longitude, index.latitudes[bestIndex], index.longitudes[bestIndex]);
  if (distanceKm > NEAR_PLACE_KM) return null;
  return {
    name: index.names[bestIndex],
    country: index.countries[bestIndex],
    distanceKm,
    inPlaceRadiusKm: inPlaceRadiusKm(index.populations[bestIndex], index.hasPopulations)
  };
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
  return place.distanceKm <= place.inPlaceRadiusKm ? full : nearLabel(full);
}

/**
 * Lista, incarcata o singura data si tinuta in memorie. `null` inseamna "am
 * incercat si nu exista" — nu se mai reincearca la fiecare deschidere de ecran.
 */
let indexPromise: Promise<PlaceIndex | null> | null = null;

/**
 * Indexul, DOAR daca s-a incarcat deja. Pentru apelantii care nu pot astepta —
 * cautarea trece prin toata biblioteca la fiecare litera tastata, deci nu are
 * cum sa astepte o promisiune per poza. Cat timp intoarce null, cautarea merge
 * fara localitati; de indata ce lista e gata, incep sa fie gasite.
 */
let loadedIndex: PlaceIndex | null = null;
export function getLoadedPlaceIndex(): PlaceIndex | null {
  return loadedIndex;
}

export function loadPlaceIndex(): Promise<PlaceIndex | null> {
  indexPromise ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}places/cities.tsv`);
      if (!response.ok) return null;
      loadedIndex = parsePlaceIndex(await response.text());
      return loadedIndex;
    } catch {
      // Build local fara pasul de CI care genereaza lista: ecranele raman pe
      // distanta si coordonate, fara nicio eroare vizibila.
      return null;
    }
  })();
  return indexPromise;
}
