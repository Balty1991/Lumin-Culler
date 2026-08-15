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
 * Aici se face DOAR gruparea; numele locurilor vin din alta parte (vezi
 * core/placeLookup.ts, care le cauta intr-o lista inclusa in aplicatie sau, la
 * alegerea utilizatorului, le cere serviciului de harti al telefonului).
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
  /** Coordonatele POZEI celei mai apropiate de centru — un loc real, caruia i se poate cere o adresa adevarata. */
  anchorLat?: number;
  anchorLon?: number;
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
/**
 * Cat de aproape trebuie sa fie doua poze ca sa fie "in acelasi loc" — 400 m.
 *
 * Observatie a utilizatorului, cu doua capturi: doua grupuri, amandoua numite
 * "Rosiori de Vede", desi pozele erau dintr-un parc, de pe o terasa si de acasa.
 * Gruparea se facea pe celule de ~11 km, adica un oras intreg intr-un singur
 * grup: locul unei poze devenea numele orasului, si toate locurile aratau la
 * fel. Un "loc" e un parc, o terasa, o curte — nu un oras.
 *
 * 400 m: destul cat cateva zeci de pasi si imprecizia GPS (5-20 m in aer liber)
 * sa nu rupa un loc in doua, destul de putin cat doua locuri diferite din
 * acelasi oras sa ramana doua.
 */
const LOCATION_CLUSTER_RADIUS_KM = 0.4;
/** Latura celulei in care se cauta "zona obisnuita" — 0.5 grade sunt ~55 km, deliberat mai mare decat o locatie, ca zona sa nu se rupa in doua de o margine de celula. */
const HOME_CELL_DEG = 0.5;
/** Cheia grupei pentru pozele fara coordonate. */
export const NO_LOCATION_KEY = 'no-location';

interface Coords {
  gpsLatitude: number;
  gpsLongitude: number;
}

/**
 * Grupurile, dupa adresa cand se stie, dupa apropiere pentru restul.
 *
 * Pozele carora li se stie adresa se aduna dupa ea, oricat de imprastiate ar fi
 * coordonatele lor. Cele fara adresa (mod offline, fara retea, sau o adresa care
 * n-a venit) cad pe gruparea dupa apropiere de mai jos, deci nu se pierd si nu
 * se lipesc de un loc care nu e al lor.
 */
function clusterByAddressOrProximity<T extends Coords & { id: string }>(
  photos: T[],
  addressByPhotoId?: Map<string, string>
): T[][] {
  if (!addressByPhotoId?.size) return clusterByProximity(photos);
  const byAddress = new Map<string, T[]>();
  const withoutAddress: T[] = [];
  for (const photo of photos) {
    const address = addressByPhotoId.get(photo.id);
    if (!address) { withoutAddress.push(photo); continue; }
    const group = byAddress.get(address);
    if (group) group.push(photo); else byAddress.set(address, [photo]);
  }
  return [...byAddress.values(), ...clusterByProximity(withoutAddress)];
}

/**
 * Grupare dupa apropiere, NU pe o grila fixa.
 *
 * Grila avea o hiba pe care nu o are apropierea: doua poze la 50 m distanta,
 * dar de o parte si de alta a unei margini de celula, ajungeau in grupuri
 * diferite, iar doua locuri la 10 km unul de altul, in aceeasi celula, ajungeau
 * impreuna. Aici o poza intra in grupul al carui centru ii e cel mai apropiat,
 * daca e sub raza de mai sus, si deschide un grup nou altfel.
 */
function clusterByProximity<T extends Coords>(photos: T[]): T[][] {
  const clusters: { lat: number; lon: number; items: T[] }[] = [];
  for (const photo of photos) {
    let best: typeof clusters[number] | undefined;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const distance = haversineKm(cluster.lat, cluster.lon, photo.gpsLatitude, photo.gpsLongitude);
      if (distance <= LOCATION_CLUSTER_RADIUS_KM && distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }
    if (!best) {
      clusters.push({ lat: photo.gpsLatitude, lon: photo.gpsLongitude, items: [photo] });
      continue;
    }
    best.items.push(photo);
    best.lat = avg(best.items.map(i => i.gpsLatitude));
    best.lon = avg(best.items.map(i => i.gpsLongitude));
  }
  return clusters.map(c => c.items);
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
export function findLocations(
  photos: PhotoView[],
  /**
   * Adresa fiecarei poze, cand se stie (id -> adresa) — vezi
   * core/placeLookup.ts si ui/LocationsPanel.tsx.
   *
   * Cand exista, gruparea se face DUPA ADRESA, nu dupa apropiere. Motivul e o
   * observatie a utilizatorului, cu capturi: doua poze facute in acelasi foisor,
   * la cateva minute distanta, aveau in EXIF coordonate la ~840 m una de alta
   * (asa e GPS-ul unui telefon sub acoperis sau la primul cadru dupa pornirea
   * camerei), iar Galeria telefonului le arata pe amandoua pe aceeasi strada.
   * Orice prag de distanta ori le rupe pe astea in doua, ori lipeste doua strazi
   * vecine — pe cand adresa spune direct ce voia utilizatorul sa vada, si spune
   * exact ce spune si Galeria, fiindca vine de la acelasi serviciu.
   */
  addressByPhotoId?: Map<string, string>
): PhotoLocationGroup[] {
  const located: (PhotoView & Coords)[] = [];
  const unlocated: PhotoView[] = [];
  for (const p of photos) {
    if (hasRealGps(p.gpsLatitude, p.gpsLongitude)) located.push(p as PhotoView & Coords);
    else unlocated.push(p);
  }

  const groups: PhotoLocationGroup[] = [];
  if (located.length) {
    const home = homeAnchor(located);
    for (const cluster of clusterByAddressOrProximity(located, addressByPhotoId)) {
      const centroidLat = avg(cluster.map(p => p.gpsLatitude));
      const centroidLon = avg(cluster.map(p => p.gpsLongitude));
      // Punctul de reper NU e centrul, ci poza cea mai apropiata de centru.
      // Centrul e o medie: un punct pe care nu s-a facut nicio poza, si caruia
      // i se poate cere o adresa care nu e a nimanui. Reperul e mereu un loc in
      // care chiar ai fost — vezi ui/LocationsPanel.tsx, unde i se cere numele.
      const anchor = cluster.reduce((best, p) =>
        haversineKm(centroidLat, centroidLon, p.gpsLatitude, p.gpsLongitude) <
        haversineKm(centroidLat, centroidLon, best.gpsLatitude, best.gpsLongitude) ? p : best
      );
      const distanceFromHomeKm = haversineKm(home.lat, home.lon, centroidLat, centroidLon);
      groups.push({
        // Cheia e id-ul pozei de reper: stabila intre randari si unica pe grup.
        key: `place-${anchor.id}`,
        photos: [...cluster].sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0)),
        ...dateRange(cluster),
        centroidLat,
        centroidLon,
        anchorLat: anchor.gpsLatitude,
        anchorLon: anchor.gpsLongitude,
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
