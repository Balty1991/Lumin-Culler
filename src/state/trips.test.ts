import { describe, it, expect } from 'vitest';
import { findTrips } from './trips';
import type { PhotoView } from './store';

// Bucuresti (acasa, in aceste teste) ~ 44.43,26.10 — Paris ~ 48.86,2.35 (~1450km distanta)
const HOME = { lat: 44.43, lon: 26.10 };
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

/** Fundal realist de poze "de rutina" la domiciliu, imprastiate pe zile SEPARATE
    (gap > TRIP_MAX_GAP_MS intre ele) — ca sa nu formeze ele insele o "calatorie",
    si sa ancoreze media (centrul "acasa") aproape de HOME, exact ca intr-o
    biblioteca reala unde majoritatea pozelor cu GPS sunt de rutina, nu de calatorie. */
function homeNoise(baseTime: number, count = 6): PhotoView[] {
  return Array.from({ length: count }, (_, i) => photo(`home-${i}`, baseTime - (i + 1) * 10 * DAY, HOME));
}

describe('findTrips', () => {
  it('groups a multi-day burst of GPS photos far from home into one trip', () => {
    const base = new Date(2026, 5, 10).getTime();
    const photos = [
      ...homeNoise(base),
      photo('a', base, FAR_AWAY),
      photo('b', base + DAY, FAR_AWAY),
      photo('c', base + 2 * DAY, FAR_AWAY)
    ];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(trips[0].distanceFromHomeKm).toBeGreaterThan(1000);
  });

  it('does not count a single-day burst as a trip, even far from home', () => {
    const base = new Date(2026, 5, 10, 9).getTime();
    const photos = [...homeNoise(base), photo('a', base, FAR_AWAY), photo('b', base + 3 * 60 * 60 * 1000, FAR_AWAY)];
    expect(findTrips(photos)).toEqual([]);
  });

  it('does not count a multi-day burst near home as a trip', () => {
    const base = new Date(2026, 5, 10).getTime();
    const photos = [...homeNoise(base), photo('a', base, HOME), photo('b', base + DAY, HOME), photo('c', base + 2 * DAY, HOME)];
    expect(findTrips(photos)).toEqual([]);
  });

  it('splits two trips separated by a large time gap', () => {
    const base = new Date(2026, 2, 1).getTime();
    const photos = [
      ...homeNoise(base),
      photo('a', base, FAR_AWAY), photo('b', base + DAY, FAR_AWAY),
      photo('c', base + 60 * DAY, FAR_AWAY), photo('d', base + 61 * DAY, FAR_AWAY)
    ];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(2);
    // cea mai recenta calatorie prima
    expect(trips[0].photos.map(p => p.id)).toEqual(['c', 'd']);
    expect(trips[1].photos.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('bridges a single day with no photos within the same trip', () => {
    const base = new Date(2026, 5, 10).getTime();
    const photos = [...homeNoise(base), photo('a', base, FAR_AWAY), photo('b', base + 2 * DAY, FAR_AWAY)];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('ignores photos without GPS data', () => {
    const base = new Date(2026, 5, 10).getTime();
    const photos = [...homeNoise(base), photo('a', base, FAR_AWAY), photo('b', base + DAY, undefined), photo('c', base + 2 * DAY, FAR_AWAY)];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'c']);
  });

  it('returns an empty array for an empty library', () => {
    expect(findTrips([])).toEqual([]);
  });

  it('returns an empty array when no photo has GPS data', () => {
    const base = new Date(2026, 5, 10).getTime();
    expect(findTrips([photo('a', base, undefined), photo('b', base + DAY, undefined)])).toEqual([]);
  });

  /**
   * Bug real raportat de utilizator: pozele importate inainte de citirea nativa
   * a locatiei au in baza 0,0 (Android lasa tag-urile GPS pe zero cand
   * redacteaza locatia). Tratate ca un loc real, toate ies "acasa" in Golful
   * Guineei, distanta fata de casa 0, si nicio calatorie nu trece pragul.
   */
  it('treats 0,0 as no location, not as a place off the coast of Africa', () => {
    const base = new Date(2026, 5, 10).getTime();
    const redacted = { lat: 0, lon: 0 };
    expect(findTrips([photo('a', base, redacted), photo('b', base + DAY, redacted)])).toEqual([]);

    // si nu strica o calatorie reala aflata in acelasi lot cu poze redactate
    const photos = [
      ...homeNoise(base),
      photo('r1', base, redacted),
      photo('a', base, FAR_AWAY),
      photo('b', base + DAY, FAR_AWAY)
    ];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'b']);
  });
});
