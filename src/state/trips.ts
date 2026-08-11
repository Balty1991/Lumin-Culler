import type { PhotoView } from './store';

export interface Trip {
  photos: PhotoView[];
  startDate: number;
  endDate: number;
  centroidLat: number;
  centroidLon: number;
  distanceFromHomeKm: number;
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
/** Distanta minima (km) fata de centrul "acasa" ca un grup de zile sa conteze ca o calatorie reala, nu doar poze de rutina cu GPS activat. */
const TRIP_MIN_DISTANCE_FROM_HOME_KM = 50;

/**
 * "Calatorii" (plan modernizare) — grupeaza pozele in calatorii pe baza datei
 * EXIF SI a coordonatelor GPS deja stocate per poza, fara niciun modul nou.
 * Aproximare deliberat simpla, nu clustering geografic real:
 *   1. Doar pozele cu GPS conteaza (multe telefoane nu ataseaza GPS deloc).
 *   2. "Acasa" = centrul (media) TUTUROR pozelor cu GPS din biblioteca — o
 *      presupunere rezonabila ca majoritatea pozelor unui utilizator obisnuit
 *      sunt facute aproape de casa, nu un clustering geografic real.
 *   3. Pozele consecutive (sortate cronologic) raman in aceeasi calatorie cat
 *      timp gap-ul dintre ele nu depaseste TRIP_MAX_GAP_MS.
 *   4. Grupul conteaza ca "calatorie" doar daca acopera 2+ zile calendaristice
 *      DISTINCTE si centrul lui e la peste TRIP_MIN_DISTANCE_FROM_HOME_KM de-acasa.
 * Sortate descrescator dupa data de start (cea mai recenta calatorie prima).
 */
export function findTrips(photos: PhotoView[]): Trip[] {
  const withGps = photos
    .filter((p): p is PhotoView & { capturedAt: number; gpsLatitude: number; gpsLongitude: number } =>
      p.capturedAt !== undefined && p.gpsLatitude !== undefined && p.gpsLongitude !== undefined)
    .sort((a, b) => a.capturedAt - b.capturedAt);
  if (withGps.length === 0) return [];

  const homeLat = avg(withGps.map(p => p.gpsLatitude));
  const homeLon = avg(withGps.map(p => p.gpsLongitude));

  const runs: (typeof withGps)[] = [];
  let current: typeof withGps = [withGps[0]];
  for (let i = 1; i < withGps.length; i++) {
    const gap = withGps[i].capturedAt - withGps[i - 1].capturedAt;
    if (gap <= TRIP_MAX_GAP_MS) current.push(withGps[i]);
    else { runs.push(current); current = [withGps[i]]; }
  }
  runs.push(current);

  const trips: Trip[] = [];
  for (const run of runs) {
    const startDate = run[0].capturedAt;
    const endDate = run[run.length - 1].capturedAt;
    if (new Date(startDate).toDateString() === new Date(endDate).toDateString()) continue;
    const centroidLat = avg(run.map(p => p.gpsLatitude));
    const centroidLon = avg(run.map(p => p.gpsLongitude));
    const distanceFromHomeKm = haversineKm(homeLat, homeLon, centroidLat, centroidLon);
    if (distanceFromHomeKm < TRIP_MIN_DISTANCE_FROM_HOME_KM) continue;
    trips.push({ photos: run, startDate, endDate, centroidLat, centroidLon, distanceFromHomeKm });
  }
  return trips.sort((a, b) => b.startDate - a.startDate);
}
