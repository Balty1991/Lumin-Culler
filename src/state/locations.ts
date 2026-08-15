import type { PhotoView } from './store';
import { hasRealGps } from '../core/gpsCoordinates';

/**
 * state/locations.ts
 * "Locații" — pozele importate, grupate dupa locul in care au fost facute.
 *
 * A inlocuit "Calatorii" (cerinta directa a utilizatorului). Calatoria era o
 * notiune ingusta — un grup de poze la peste X km de casa, tinand mai multe
 * zile — si, pentru o biblioteca obisnuita, ecranul ramanea gol la nesfarsit,
 * fara sa fie nimic stricat. Aici nu se mai judeca nimic: daca poza are
 * coordonate, apare la locul ei; daca nu are, apare intr-o grupa separata,
 * spusa pe fata. Ecranul arata ce stie aplicatia, nu ce n-a gasit.
 *
 * Nu exista nume de locuri, doar coordonate si distante: numele ar cere o
 * cautare inversa pe internet, iar aplicatia nu trimite nimic nicaieri.
 */

export interface PhotoLocationGroup {
  /** Cheie stabila pentru randare (celula de coordonate sau grupa fara locatie). */
  key: string;
  photos: PhotoView[];
  /** Cea mai veche/noua data de captura din grup — absente daca nicio poza din grup n-are data. */
  startDate?: number;
  endDate?: number;
  /** Absente pentru grupa fara locatie. */
  centroidLat?: number;
  centroidLon?: number;
  distanceFromHomeKm?: number;
  /** Grupa asta e in zona in care faci de obicei poze. */
  isHome: boolean;
  /** false doar pentru grupa "fara locatie disponibila". */
  hasLocation: boolean;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distanta mare-cerc intre 2 puncte GPS (formula haversine) — precisa pentru distantele care ne intereseaza aici (zeci-sute de km), fara sa aiba nevoie de un model geoid mai complex. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function avg(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sub atata, o grupa e in zona in care traiesti — nu are rost sa i se spuna distanta. */
export const HOME_RADIUS_KM = 25;
/** Latura celulei unei locatii — 0.1 grade de latitudine sunt ~11 km, adica un oras cu imprejurimile lui. */
const LOCATION_CELL_DEG = 0.1;
/** Latura celulei in care se cauta "zona obisnuita" — 0.5 grade sunt ~55 km, deliberat mai mare decat o locatie, ca zona sa nu se rupa in doua de o margine de celula. */
const HOME_CELL_DEG = 0.5;
/** Cheia grupei pentru pozele fara coordonate. */
export const NO_LOCATION_KEY = 'no-location';

interface Coords {
  gpsLatitude: number;
  gpsLongitude: number;
}

function cellKey(p: Coords, size: number): string {
  return `${Math.floor(p.gpsLatitude / size)}:${Math.floor(p.gpsLongitude / size)}`;
}

function groupByCell<T extends Coords>(photos: T[], size: number): Map<string, T[]> {
  const cells = new Map<string, T[]>();
  for (const p of photos) {
    const key = cellKey(p, size);
    const cell = cells.get(key);
    if (cell) cell.push(p); else cells.set(key, [p]);
  }
  return cells;
}

/**
 * "Zona obisnuita" — celula de ~55 km in care ai cele mai multe poze, NU media
 * tuturor coordonatelor.
 *
 * Media nu cade unde stai, ci INTRE locuri: cu jumatate din poze acasa si
 * jumatate dintr-o vacanta, iese pe la mijlocul drumului, si atunci ambele
 * capete par la fel de "aproape de casa". Bug real, gasit dupa ce citirea
 * locatiei a inceput sa functioneze. Celula cea mai populata nu are problema
 * asta: cateva poze de excursie nu misca locul in care traiesti.
 */
function homeAnchor(photos: Coords[]): { lat: number; lon: number } {
  let densest: Coords[] = [];
  for (const cell of groupByCell(photos, HOME_CELL_DEG).values()) {
    if (cell.length > densest.length) densest = cell;
  }
  return {
    lat: avg(densest.map(p => p.gpsLatitude)),
    lon: avg(densest.map(p => p.gpsLongitude))
  };
}

/** Intervalul de date al unui grup, din pozele care chiar au data capturii (unele n-au). */
function dateRange(photos: PhotoView[]): { startDate?: number; endDate?: number } {
  const dates = photos.map(p => p.capturedAt).filter((d): d is number => d !== undefined);
  if (!dates.length) return {};
  return { startDate: Math.min(...dates), endDate: Math.max(...dates) };
}

/**
 * Toate pozele importate, grupate pe locatii.
 *
 * Ordinea: locatiile cu cele mai multe poze primele (acolo ai de cautat cel mai
 * des), iar grupa "fara locatie" mereu ULTIMA — e o categorie de rest, nu un
 * loc, si n-are ce cauta in capul listei oricat de multe poze ar aduna.
 *
 * O poza fara coordonate reale (inclusiv 0,0, valoarea pe care o lasa Android
 * cand redacteaza locatia — vezi core/gpsCoordinates.ts) intra in grupa de
 * rest, nu intr-un loc inventat.
 */
export function findLocations(photos: PhotoView[]): PhotoLocationGroup[] {
  const located: (PhotoView & Coords)[] = [];
  const unlocated: PhotoView[] = [];
  for (const p of photos) {
    if (hasRealGps(p.gpsLatitude, p.gpsLongitude)) located.push(p as PhotoView & Coords);
    else unlocated.push(p);
  }

  const groups: PhotoLocationGroup[] = [];
  if (located.length) {
    const home = homeAnchor(located);
    for (const [key, cell] of groupByCell(located, LOCATION_CELL_DEG)) {
      const centroidLat = avg(cell.map(p => p.gpsLatitude));
      const centroidLon = avg(cell.map(p => p.gpsLongitude));
      const distanceFromHomeKm = haversineKm(home.lat, home.lon, centroidLat, centroidLon);
      groups.push({
        key,
        photos: [...cell].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)),
        ...dateRange(cell),
        centroidLat,
        centroidLon,
        distanceFromHomeKm,
        isHome: distanceFromHomeKm < HOME_RADIUS_KM,
        hasLocation: true
      });
    }
    // Cele mai multe poze primele; la egalitate, cea mai recenta.
    groups.sort((a, b) => b.photos.length - a.photos.length || (b.endDate ?? 0) - (a.endDate ?? 0));
  }

  if (unlocated.length) {
    groups.push({
      key: NO_LOCATION_KEY,
      photos: [...unlocated].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)),
      ...dateRange(unlocated),
      isHome: false,
      hasLocation: false
    });
  }
  return groups;
}

/** Cate locatii REALE (fara grupa de rest) — pentru cardul de pe Acasa. */
export function countRealLocations(photos: PhotoView[]): number {
  return findLocations(photos).filter(g => g.hasLocation).length;
}
