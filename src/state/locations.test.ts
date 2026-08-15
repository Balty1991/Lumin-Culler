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
