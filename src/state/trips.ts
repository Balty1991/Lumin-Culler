import type { PhotoView } from './store';
import { hasRealGps } from '../core/gpsCoordinates';

export interface Trip {
  photos: PhotoView[];
  startDate: number;
  endDate: number;
  centroidLat: number;
  centroidLon: number;
  distanceFromHomeKm: number;
  /** Doar pentru "locuri" (findPlaces): gruparea asta E zona ta obisnuita, nu o iesire din ea. */
  isHome?: boolean;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distanta mare-cerc intre 2 puncte GPS (formula haversine) — precisa pentru distantele la care ne intereseaza aici (zeci-sute de km), fara sa aiba nevoie de un model geoid mai complex. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function avg(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Gap maxim intre poze consecutive ca sa ramana in aceeasi "calatorie" — 48h acopera
    o zi calendaristica intreaga fara nicio poza (ex. o zi petrecuta la hotel, fara sa
    scoti telefonul), oricare ar fi ora din zi a ultimei/primei poze din zilele vecine,
    fara sa uneasca 2 calatorii separate la saptamani distanta. */
const TRIP_MAX_GAP_MS = 48 * 60 * 60 * 1000;
/**
 * Distanta minima (km) fata de zona obisnuita ca un grup sa conteze drept
 * calatorie.
 *
 * 25, nu 50: observatie a utilizatorului, dupa ce citirea locatiei a inceput sa
 * functioneze — "pe telefon pozele au locatie, fa cumva sa apara". La 50 km,
 * definitia cerea practic o vacanta; o zi intreaga petrecuta in orasul vecin,
 * la 30 km, nu se califica, desi pentru cine a facut pozele ala e exact genul
 * de iesire pe care vrea s-o regaseasca. 25 km e destul cat sa nu prinda
 * drumurile prin propriul oras.
 */
export const TRIP_MIN_DISTANCE_FROM_HOME_KM = 25;
/**
 * Cate poze trebuie sa aiba un grup de O SINGURA zi ca sa conteze drept iesire.
 *
 * Pana acum se cereau obligatoriu 2 zile calendaristice, ceea ce excludea din
 * start orice excursie de o zi — cea mai obisnuita forma de iesire. O poza
 * singura facuta in trecere (o oprire pe drum) nu e insa o iesire, de-aici
 * pragul.
 */
const DAY_TRIP_MIN_PHOTOS = 3;
/** Latura celulei in care se grupeaza "locurile" — 0.1 grade de latitudine sunt ~11 km, adica un oras si imprejurimile lui. */
const PLACE_CELL_DEG = 0.1;
/** Latura celulei in care se numara pozele cand se cauta "zona obisnuita" — 0.5 grade de latitudine inseamna ~55 km, adica exact ordinul de marime al pragului de mai sus. */
const HOME_CELL_DEG = 0.5;

interface Located {
  capturedAt: number;
  gpsLatitude: number;
  gpsLongitude: number;
}

/**
 * "Zona obisnuita" — celula de ~55 km in care ai cele mai multe poze, NU media
 * tuturor coordonatelor.
 *
 * Media era gresita exact in cazul care conteaza: ea nu cade unde stai, ci
 * INTRE locuri. Cu jumatate din poze acasa si jumatate dintr-o vacanta, media
 * iese pe la mijlocul drumului — si casa, si vacanta par atunci "aproape de
 * casa", deci nicio calatorie nu trece pragul. Si invers: cateva poze dintr-un
 * loc indepartat mutau "casa" cu zeci de km degeaba.
 *
 * Celula cea mai populata nu are problema asta: cateva poze de excursie nu
 * misca locul in care traiesti. Ramane o aproximare (o singura "casa", nu mai
 * multe resedinte), dar una care nu mai depinde de cate poze de vacanta ai
 * importat in sesiunea curenta.
 */
function homeAnchor(photos: Located[]): { lat: number; lon: number } {
  const cells = new Map<string, Located[]>();
  for (const p of photos) {
    const key = `${Math.floor(p.gpsLatitude / HOME_CELL_DEG)}:${Math.floor(p.gpsLongitude / HOME_CELL_DEG)}`;
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }
  let densest: Located[] = [];
  for (const cell of cells.values()) {
    if (cell.length > densest.length) densest = cell;
  }
  return {
    lat: avg(densest.map(p => p.gpsLatitude)),
    lon: avg(densest.map(p => p.gpsLongitude))
  };
}

/** Pozele care pot participa la o calatorie: au si data capturii, si o locatie reala. */
function locatedPhotos(photos: PhotoView[]): (PhotoView & Located)[] {
  return photos
    // hasRealGps, nu doar "au valoare": pozele importate inainte de citirea
    // nativa a locatiei au in baza 0,0 (redactarea Android lasa tag-urile GPS
    // cu zero — vezi core/gpsCoordinates.ts). Tratate ca un loc real, toate ar
    // fi considerate in acelasi punct din Golful Guineei.
    .filter((p): p is PhotoView & Located =>
      p.capturedAt !== undefined && hasRealGps(p.gpsLatitude, p.gpsLongitude))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Poze consecutive in timp, taiate acolo unde pauza depaseste TRIP_MAX_GAP_MS. */
function splitIntoRuns<T extends Located>(photos: T[]): T[][] {
  if (!photos.length) return [];
  const runs: T[][] = [];
  let current: T[] = [photos[0]];
  for (let i = 1; i < photos.length; i++) {
    if (photos[i].capturedAt - photos[i - 1].capturedAt <= TRIP_MAX_GAP_MS) current.push(photos[i]);
    else { runs.push(current); current = [photos[i]]; }
  }
  runs.push(current);
  return runs;
}

/** Un grup acopera 2+ zile calendaristice DISTINCTE. */
function spansMultipleDays(run: Located[]): boolean {
  return new Date(run[0].capturedAt).toDateString() !== new Date(run[run.length - 1].capturedAt).toDateString();
}

/** Grup destul de consistent cat sa fie o iesire: ori tine mai multe zile, ori are destule poze intr-una singura. */
function looksLikeAnOuting(run: Located[]): boolean {
  return spansMultipleDays(run) || run.length >= DAY_TRIP_MIN_PHOTOS;
}

/**
 * "Calatorii" (plan modernizare) — grupeaza pozele in calatorii pe baza datei
 * EXIF SI a coordonatelor GPS deja stocate per poza, fara niciun modul nou.
 * Aproximare deliberat simpla, nu clustering geografic real:
 *   1. Doar pozele cu locatie reala conteaza (multe poze n-au deloc).
 *   2. "Acasa" = celula de ~55 km cu cele mai multe poze — vezi homeAnchor.
 *   3. Pozele consecutive (sortate cronologic) raman in aceeasi calatorie cat
 *      timp gap-ul dintre ele nu depaseste TRIP_MAX_GAP_MS.
 *   4. Grupul conteaza ca "calatorie" daca arata a iesire (2+ zile SAU destule
 *      poze intr-o zi — vezi looksLikeAnOuting) si centrul lui e la peste
 *      TRIP_MIN_DISTANCE_FROM_HOME_KM de zona obisnuita.
 * Sortate descrescator dupa data de start (cea mai recenta calatorie prima).
 */
export function findTrips(photos: PhotoView[]): Trip[] {
  const withGps = locatedPhotos(photos);
  if (withGps.length === 0) return [];
  const home = homeAnchor(withGps);

  const trips: Trip[] = [];
  for (const run of splitIntoRuns(withGps)) {
    if (!looksLikeAnOuting(run)) continue;
    const centroidLat = avg(run.map(p => p.gpsLatitude));
    const centroidLon = avg(run.map(p => p.gpsLongitude));
    const distanceFromHomeKm = haversineKm(home.lat, home.lon, centroidLat, centroidLon);
    if (distanceFromHomeKm < TRIP_MIN_DISTANCE_FROM_HOME_KM) continue;
    trips.push({
      photos: run,
      startDate: run[0].capturedAt,
      endDate: run[run.length - 1].capturedAt,
      centroidLat,
      centroidLon,
      distanceFromHomeKm
    });
  }
  return trips.sort((a, b) => b.startDate - a.startDate);
}

/**
 * De ce nu s-a gasit nicio calatorie — ca ecranul gol sa spuna care dintre cele
 * trei conditii lipseste, in loc sa repete aceeasi propozitie generala.
 *
 * Observatie a utilizatorului, de mai multe ori la rand: "in calatorii nimic",
 * fara nicio cale de a sti daca functia e stricata, daca pozelor le lipseste
 * locatia, sau daca pur si simplu n-a fost nicaieri. Sunt trei situatii
 * complet diferite si doar prima e un bug.
 */
export interface TripSearchSummary {
  /** Cate poze au si data capturii, si o locatie reala. */
  withLocation: number;
  /** Cate grupuri de poze consecutive acopera 2+ zile calendaristice. */
  multiDayGroups: number;
  /** Cea mai mare distanta fata de zona obisnuita atinsa de un grup de 2+ zile. Absenta daca nu exista niciun astfel de grup. */
  farthestGroupKm?: number;
}

export function summarizeTripSearch(photos: PhotoView[]): TripSearchSummary {
  const withGps = locatedPhotos(photos);
  if (withGps.length === 0) return { withLocation: 0, multiDayGroups: 0 };
  const home = homeAnchor(withGps);
  const multiDay = splitIntoRuns(withGps).filter(looksLikeAnOuting);
  const distances = multiDay.map(run =>
    haversineKm(home.lat, home.lon, avg(run.map(p => p.gpsLatitude)), avg(run.map(p => p.gpsLongitude)))
  );
  return {
    withLocation: withGps.length,
    multiDayGroups: multiDay.length,
    ...(distances.length ? { farthestGroupKm: Math.max(...distances) } : {})
  };
}

/**
 * Locurile din care ai poze, grupate pe zone de ~11 km — folosite cand nu s-a
 * calificat nicio calatorie, ca ecranul sa arate ce STIE, nu doar ce n-a gasit.
 *
 * Cerinta directa a utilizatorului: "pe telefon pozele au locatie, fa cumva sa
 * apara". O calatorie ramane ceva anume (o iesire departe de casa), si nu se
 * inventeaza una cand nu exista — dar daca pozele chiar au coordonate, e
 * absurd ca ecranul dedicat locurilor sa fie gol. Locurile sunt aceleasi date,
 * fara nicio conditie de distanta sau de durata: aici ai fost, atatea poze ai
 * facut, atunci.
 *
 * Aceeasi forma ca o calatorie (Trip), ca sa poata fi randate cu acelasi card;
 * cel din zona obisnuita e marcat cu isHome, ca sa nu scrie "~1 km de casa"
 * despre casa. Sortate cu cel mai indepartat primul — locul in care esti mereu
 * e cel mai putin interesant de recitit.
 */
export function findPlaces(photos: PhotoView[]): Trip[] {
  const withGps = locatedPhotos(photos);
  if (withGps.length === 0) return [];
  const home = homeAnchor(withGps);

  const cells = new Map<string, (PhotoView & Located)[]>();
  for (const p of withGps) {
    const key = `${Math.floor(p.gpsLatitude / PLACE_CELL_DEG)}:${Math.floor(p.gpsLongitude / PLACE_CELL_DEG)}`;
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }

  const places = [...cells.values()].map(group => {
    const centroidLat = avg(group.map(p => p.gpsLatitude));
    const centroidLon = avg(group.map(p => p.gpsLongitude));
    const distanceFromHomeKm = haversineKm(home.lat, home.lon, centroidLat, centroidLon);
    return {
      photos: group,
      startDate: group[0].capturedAt,
      endDate: group[group.length - 1].capturedAt,
      centroidLat,
      centroidLon,
      distanceFromHomeKm,
      // Acelasi prag ca la calatorii: sub el esti in zona in care traiesti, si
      // n-are rost sa i se spuna "~2 km de casa" despre casa.
      isHome: distanceFromHomeKm < TRIP_MIN_DISTANCE_FROM_HOME_KM
    };
  });
  return places.sort((a, b) => b.distanceFromHomeKm - a.distanceFromHomeKm);
}
