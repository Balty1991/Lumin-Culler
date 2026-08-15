import { describe, it, expect } from 'vitest';
import { findLocations, countRealLocations, NO_LOCATION_KEY } from './locations';
import type { PhotoView } from './store';

// Rosiori de Vede (zona obisnuita, in aceste teste) ~ 44.11,24.98
// Bucuresti ~ 44.43,26.10 (~90 km) · Paris ~ 48.86,2.35 (~1900 km)
const HOME = { lat: 44.11, lon: 24.98 };
const NEXT_CITY = { lat: 44.43, lon: 26.10 };
const FAR_AWAY = { lat: 48.86, lon: 2.35 };
const DAY = 24 * 60 * 60 * 1000;

function photo(id: string, capturedAt: number | undefined, gps?: { lat: number; lon: number }): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 0, status: 'pending', rating: 0, aiScore: 50,
    sceneType: 'detail', contextKey: '', faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 0, exposure: 0, ruleOfThirds: 0, headroom: 0,
    aiFactors: [], personNames: [], personMatches: [], capturedAt,
    gpsLatitude: gps?.lat, gpsLongitude: gps?.lon
  };
}

const base = new Date(2026, 7, 11, 10, 0).getTime();

describe('findLocations', () => {
  it('returns nothing for an empty library', () => {
    expect(findLocations([])).toEqual([]);
  });

  it('groups photos taken in the same area into one location', () => {
    const groups = findLocations([
      photo('a', base, HOME),
      photo('b', base + 3600000, HOME),
      photo('c', base + DAY, HOME)
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].photos.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(groups[0].hasLocation).toBe(true);
    expect(groups[0].isHome).toBe(true);
  });

  /**
   * Observatie a utilizatorului, cu doua capturi: doua grupuri, amandoua numite
   * "Rosiori de Vede", desi pozele erau dintr-un parc, de pe o terasa si de
   * acasa. Se grupa pe celule de ~11 km — un oras intreg intr-un grup.
   */
  it('separates two spots in the same town', () => {
    const PARK = { lat: 44.1155, lon: 25.0035 };       // ~1.4 km de HOME
    const groups = findLocations([
      photo('h1', base, HOME),
      photo('h2', base + 3600000, HOME),
      photo('p1', base + 7200000, PARK),
      photo('p2', base + 10800000, PARK)
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.photos.length)).toEqual([2, 2]);
    const ids = groups.map(g => g.photos.map(p => p.id).sort().join(','));
    expect(ids.sort()).toEqual(['h1,h2', 'p1,p2']);
  });

  /** Cativa pasi, sau imprecizia GPS, nu rup un loc in doua. */
  it('keeps photos a few dozen metres apart in the same place', () => {
    const groups = findLocations([
      photo('a', base, HOME),
      photo('b', base + 60000, { lat: HOME.lat + 0.0005, lon: HOME.lon + 0.0005 }), // ~70 m
      photo('c', base + 120000, { lat: HOME.lat - 0.0008, lon: HOME.lon }) // ~90 m
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].photos).toHaveLength(3);
  });

  /** Reperul e o poza reala, nu media coordonatelor — vezi comentariul din findLocations. */
  it('anchors the group on an actual photo, not on the average point', () => {
    const groups = findLocations([
      photo('a', base, HOME),
      photo('b', base + 60000, { lat: HOME.lat + 0.002, lon: HOME.lon })
    ]);
    const [group] = groups;
    const anchorIsAPhoto = group.photos.some(
      p => p.gpsLatitude === group.anchorLat && p.gpsLongitude === group.anchorLon
    );
    expect(anchorIsAPhoto).toBe(true);
  });

  it('keeps distinct areas apart and marks only the usual one as home', () => {
    const photos = [
      ...Array.from({ length: 5 }, (_, i) => photo(`h${i}`, base + i * DAY, HOME)),
      photo('n1', base, NEXT_CITY),
      photo('n2', base + 3600000, NEXT_CITY)
    ];
    const groups = findLocations(photos);
    expect(groups).toHaveLength(2);
    const [home, next] = groups; // sortate dupa numarul de poze
    expect(home.isHome).toBe(true);
    expect(home.photos).toHaveLength(5);
    expect(next.isHome).toBe(false);
    expect(Math.round(next.distanceFromHomeKm ?? 0)).toBeGreaterThan(50);
  });

  /**
   * Cerinta directa a utilizatorului: pozele fara coordonate nu se pierd si nu
   * se lipesc de un loc inventat — au categoria lor, spusa pe fata.
   */
  it('collects photos without coordinates into their own group, always last', () => {
    const groups = findLocations([
      photo('no1', base, undefined),
      photo('no2', base + DAY, undefined),
      photo('no3', base, { lat: 0, lon: 0 }), // locatie stearsa de Android, nu un loc
      photo('a', base, HOME)
    ]);
    expect(groups).toHaveLength(2);
    const last = groups[groups.length - 1];
    expect(last.key).toBe(NO_LOCATION_KEY);
    expect(last.hasLocation).toBe(false);
    expect(last.photos.map(p => p.id).sort()).toEqual(['no1', 'no2', 'no3']);
    expect(last.centroidLat).toBeUndefined();
  });

  it('puts the group with no location last even when it is the biggest', () => {
    const groups = findLocations([
      ...Array.from({ length: 10 }, (_, i) => photo(`no${i}`, base + i * DAY, undefined)),
      photo('a', base, HOME)
    ]);
    expect(groups.map(g => g.key === NO_LOCATION_KEY)).toEqual([false, true]);
  });

  it('reports the real date range of each group', () => {
    const groups = findLocations([
      photo('a', base + 2 * DAY, FAR_AWAY),
      photo('b', base, FAR_AWAY)
    ]);
    expect(groups[0].startDate).toBe(base);
    expect(groups[0].endDate).toBe(base + 2 * DAY);
    expect(groups[0].photos.map(p => p.id)).toEqual(['b', 'a']); // cronologic in interiorul grupei
  });

  it('handles photos with a location but no capture date', () => {
    const groups = findLocations([photo('a', undefined, HOME)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].hasLocation).toBe(true);
    expect(groups[0].startDate).toBeUndefined();
  });
});

/**
 * Observatie a utilizatorului, cu capturi: doua poze facute in acelasi foisor, la
 * cateva minute distanta, aveau in EXIF coordonate la ~840 m una de alta, iar
 * Galeria telefonului le arata pe amandoua pe aceeasi strada. Orice prag de
 * distanta ori le rupe pe astea, ori lipeste doua strazi vecine.
 */
describe('findLocations, dupa adresa', () => {
  const SAME_SPOT_A = { lat: 44.116, lon: 25.004 };
  const SAME_SPOT_B = { lat: 44.112, lon: 24.995 }; // ~840 m mai incolo, acelasi loc real

  it('keeps photos with the same address together, however far apart their coordinates', () => {
    const addresses = new Map([
      ['a', 'Strada Oituz, Roșiori de Vede, România'],
      ['b', 'Strada Oituz, Roșiori de Vede, România']
    ]);
    const groups = findLocations(
      [photo('a', base, SAME_SPOT_A), photo('b', base + 60000, SAME_SPOT_B)],
      addresses
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].photos.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('keeps different addresses apart even when the coordinates are close', () => {
    const addresses = new Map([
      ['a', 'Strada Oituz 1, Roșiori de Vede, România'],
      ['b', 'Strada Republicii 2, Roșiori de Vede, România']
    ]);
    const groups = findLocations(
      [photo('a', base, HOME), photo('b', base + 60000, { lat: HOME.lat + 0.0005, lon: HOME.lon })],
      addresses
    );
    expect(groups).toHaveLength(2);
  });

  it('falls back to proximity for photos whose address is unknown', () => {
    const addresses = new Map([['a', 'Strada Oituz, Roșiori de Vede, România']]);
    const groups = findLocations(
      [photo('a', base, HOME), photo('b', base + 60000, HOME), photo('c', base, NEXT_CITY)],
      addresses
    );
    // 'a' dupa adresa; 'b' si 'c' dupa apropiere, in doua locuri diferite
    expect(groups).toHaveLength(3);
  });
});

describe('countRealLocations', () => {
  it('counts places only, never the no-location group', () => {
    expect(countRealLocations([photo('no', base, undefined)])).toBe(0);
    expect(countRealLocations([
      photo('a', base, HOME),
      photo('b', base, NEXT_CITY),
      photo('no', base, undefined)
    ])).toBe(2);
  });
});