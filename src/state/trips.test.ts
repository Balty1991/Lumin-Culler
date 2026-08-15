import { describe, it, expect } from 'vitest';
import { findTrips, findPlaces, summarizeTripSearch } from './trips';
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

  /**
   * Bug real raportat de utilizator: locatia se citea corect, dar "Calatorii"
   * ramanea gol. "Acasa" era MEDIA tuturor coordonatelor — cu jumatate din poze
   * acasa si jumatate in vacanta, media cade la mijlocul drumului, deci ambele
   * capete par aproape de "casa" si nicio calatorie nu trece pragul de 50 km.
   */
  it('finds the trip even when half the located photos are from it', () => {
    const base = new Date(2026, 5, 10).getTime();
    const HOME = { lat: 44.43, lon: 26.10 };            // Bucuresti
    const AWAY = { lat: 45.65, lon: 25.60 };            // Brasov, ~145 km
    const photos = [
      photo('h1', base - 10 * DAY, HOME),
      photo('h2', base - 9 * DAY, HOME),
      photo('h3', base - 8 * DAY, HOME),
      photo('a', base, AWAY),
      photo('b', base + DAY, AWAY),
      photo('c', base + DAY + 3600000, AWAY)
    ];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(Math.round(trips[0].distanceFromHomeKm)).toBeGreaterThan(100);
  });

  describe('summarizeTripSearch', () => {
    it('spune cate poze au locatie reala', () => {
      const base = new Date(2026, 5, 10).getTime();
      const s = summarizeTripSearch([
        photo('a', base, { lat: 44.43, lon: 26.10 }),
        photo('b', base + DAY, undefined),
        photo('c', base + 2 * DAY, { lat: 0, lon: 0 })
      ]);
      expect(s.withLocation).toBe(1);
    });

    it('deosebeste "toate dintr-o singura zi" de "prea aproape de casa"', () => {
      const base = new Date(2026, 5, 10).getTime();
      const HOME = { lat: 44.43, lon: 26.10 };
      // doua poze in aceeasi zi: niciun grup de 2+ zile
      const singleDay = summarizeTripSearch([photo('a', base, HOME), photo('b', base + 3600000, HOME)]);
      expect(singleDay.multiDayGroups).toBe(0);
      expect(singleDay.farthestGroupKm).toBeUndefined();

      // doua zile la rand, dar acasa
      const nearby = summarizeTripSearch([photo('a', base, HOME), photo('b', base + DAY, HOME)]);
      expect(nearby.multiDayGroups).toBe(1);
      expect(nearby.farthestGroupKm).toBeLessThan(50);
    });
  });

  /**
   * Cerinta directa a utilizatorului ("pe telefon pozele au locatie, fa cumva sa
   * apara"): o excursie de o zi in orasul vecin e cea mai obisnuita forma de
   * iesire, si era exclusa din start de cerinta celor 2 zile calendaristice.
   */
  it('counts a day trip with enough photos, not just multi-day ones', () => {
    const base = new Date(2026, 5, 10, 9, 0).getTime();
    const HOME = { lat: 44.11, lon: 24.98 };            // Rosiori de Vede
    const AWAY = { lat: 44.43, lon: 26.10 };            // Bucuresti, ~90 km
    const photos = [
      ...Array.from({ length: 6 }, (_, i) => photo(`h${i}`, base - (10 + i) * DAY, HOME)),
      photo('a', base, AWAY),
      photo('b', base + 3600000, AWAY),
      photo('c', base + 7200000, AWAY)
    ];
    const trips = findTrips(photos);
    expect(trips).toHaveLength(1);
    expect(trips[0].photos.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not turn a single photo taken in passing into a trip', () => {
    const base = new Date(2026, 5, 10, 9, 0).getTime();
    const HOME = { lat: 44.11, lon: 24.98 };
    const AWAY = { lat: 44.43, lon: 26.10 };
    const photos = [
      ...Array.from({ length: 6 }, (_, i) => photo(`h${i}`, base - (10 + i) * DAY, HOME)),
      photo('single', base, AWAY)
    ];
    expect(findTrips(photos)).toEqual([]);
  });

  describe('findPlaces', () => {
    it('groups photos by area even when nothing qualifies as a trip', () => {
      const base = new Date(2026, 5, 10, 9, 0).getTime();
      const HOME = { lat: 44.11, lon: 24.98 };
      const places = findPlaces([photo('a', base, HOME), photo('b', base + 3600000, HOME)]);
      expect(places).toHaveLength(1);
      expect(places[0].photos).toHaveLength(2);
      expect(places[0].isHome).toBe(true);
    });

    it('puts the farthest place first and marks only the usual area as home', () => {
      const base = new Date(2026, 5, 10, 9, 0).getTime();
      const HOME = { lat: 44.11, lon: 24.98 };
      const AWAY = { lat: 44.43, lon: 26.10 };
      const photos = [
        ...Array.from({ length: 4 }, (_, i) => photo(`h${i}`, base - i * DAY, HOME)),
        photo('a', base, AWAY)
      ];
      const places = findPlaces(photos);
      expect(places).toHaveLength(2);
      expect(places[0].isHome).toBe(false);
      expect(places[0].photos.map(p => p.id)).toEqual(['a']);
      expect(places[1].isHome).toBe(true);
    });

    it('ignores photos without a real location', () => {
      const base = new Date(2026, 5, 10).getTime();
      expect(findPlaces([photo('a', base, { lat: 0, lon: 0 }), photo('b', base, undefined)])).toEqual([]);
    });
  });
});
