import { describe, it, expect } from 'vitest';
import { parsePlaceIndex, findNearestPlace, formatPlace } from './placeNames';

/** Exact formatul pe care il scrie pasul "Bundle place names" din CI: nume, lat, lon, tara, populatie. */
const SAMPLE = [
  'Roșiori de Vede\t44.1143\t24.9868\tRO\t27760',
  'București\t44.4323\t26.1063\tRO\t1877155',
  'Alexandria\t43.9700\t25.3333\tRO\t45434',
  'Paris\t48.8534\t2.3488\tFR\t2138551'
].join('\n');

const index = parsePlaceIndex(SAMPLE);
const near = (name: string) => `lângă ${name}`;

describe('parsePlaceIndex', () => {
  it('reads every complete row, sorted by latitude', () => {
    // ordinea din fisier nu conteaza: lista se sorteaza ca sa poata fi cautata
    // pe fasii de latitudine
    expect(index.names).toEqual(['Alexandria', 'Roșiori de Vede', 'București', 'Paris']);
    expect(index.latitudes[1]).toBeCloseTo(44.1143, 4);
    expect(index.countries[3]).toBe('FR');
    expect(index.populations[3]).toBe(2138551);
    expect(index.hasPopulations).toBe(true);
  });

  it('accepts an older four-column file, without populations', () => {
    const old = parsePlaceIndex('Roșiori de Vede\t44.1143\t24.9868\tRO');
    expect(old.names).toEqual(['Roșiori de Vede']);
    expect(old.hasPopulations).toBe(false);
  });

  it('skips broken rows instead of failing the whole list', () => {
    const broken = parsePlaceIndex(
      'Bun\t44.1\t24.9\tRO\t900\nrand fara coloane\nAlt loc\tnu-i numar\t24.9\tRO\t900\n\nAltul\t45.0\t25.0\tRO\t900'
    );
    expect(broken.names).toEqual(['Bun', 'Altul']);
  });

  it('treats an unreadable population as unknown, keeping the row', () => {
    const odd = parsePlaceIndex('Undeva\t44.11\t24.99\tRO\t');
    expect(odd.names).toEqual(['Undeva']);
    expect(odd.populations[0]).toBe(0);
  });

  it('survives an empty file', () => {
    expect(parsePlaceIndex('').names).toEqual([]);
  });
});

describe('findNearestPlace', () => {
  it('finds the town the photo was taken in', () => {
    // coordonatele reale dintr-o poza a utilizatorului
    const place = findNearestPlace(index, 44.11431, 24.98677);
    expect(place?.name).toBe('Roșiori de Vede');
    expect(place?.distanceKm).toBeLessThan(1);
  });

  it('picks the nearest, not the biggest', () => {
    // intre Rosiori si Alexandria, dar mai aproape de Alexandria
    expect(findNearestPlace(index, 43.99, 25.30)?.name).toBe('Alexandria');
  });

  it('claims nothing in the middle of nowhere', () => {
    // Marea Neagra, la sute de km de orice localitate din lista
    expect(findNearestPlace(index, 43.5, 32.0)).toBeNull();
  });

  it('crosses the antimeridian instead of measuring the long way round', () => {
    const pacific = parsePlaceIndex('Vaitogi\t-14.35\t-170.75\tAS\t1000');
    // acelasi loc, exprimat la +189.25 grade — diferenta bruta de longitudine
    // e 360, distanta reala e zero
    expect(findNearestPlace(pacific, -14.35, 189.25)?.name).toBe('Vaitogi');
  });

  it('returns nothing for an empty list', () => {
    expect(findNearestPlace(parsePlaceIndex(''), 44.1, 24.9)).toBeNull();
  });
});

describe('in-place radius', () => {
  /**
   * Un prag fix e gresit in ambele sensuri: prea larg pentru un sat, prea
   * stramt pentru un oras mare, al carui punct din lista e centrul. Raza creste
   * cu radacina populatiei.
   */
  it('grows with the size of the place', () => {
    const big = findNearestPlace(index, 44.4323, 26.1063)!;
    const small = findNearestPlace(index, 44.1143, 24.9868)!;
    expect(big.inPlaceRadiusKm).toBeGreaterThan(small.inPlaceRadiusKm);
    expect(big.inPlaceRadiusKm).toBeLessThanOrEqual(12);
    expect(small.inPlaceRadiusKm).toBeGreaterThanOrEqual(1.5);
  });

  it('stays modest for a hamlet', () => {
    const hamlet = parsePlaceIndex('Cătun\t44.11\t24.99\tRO\t520');
    expect(findNearestPlace(hamlet, 44.11, 24.99)!.inPlaceRadiusKm).toBe(1.5);
  });

  it('keeps the old fixed threshold for a four-column file', () => {
    const old = parsePlaceIndex('Undeva\t44.11\t24.99\tRO');
    expect(findNearestPlace(old, 44.11, 24.99)!.inPlaceRadiusKm).toBe(5);
  });
});

describe('formatPlace', () => {
  it('names the place and the country', () => {
    const place = findNearestPlace(index, 44.11431, 24.98677)!;
    expect(formatPlace(place, 'ro', near)).toBe('Roșiori de Vede, România');
    expect(formatPlace(place, 'en', near)).toBe('Roșiori de Vede, Romania');
  });

  /**
   * Asezarile mici lipsesc din lista (GeoNames cities500 tine ce trece de ~500
   * de locuitori, plus resedintele). Pentru ele se arata cea mai apropiata
   * localitate cunoscuta, dar MARCATA ca atare — altfel poza dintr-un sat ar
   * primi numele orasului vecin ca si cum ar fi sigur.
   */
  it('says "near" when the photo is not in the place itself', () => {
    const place = findNearestPlace(index, 44.30, 25.10)!;
    expect(place.distanceKm).toBeGreaterThan(place.inPlaceRadiusKm);
    expect(formatPlace(place, 'ro', near)).toMatch(/^lângă /);
  });

  it('still calls a big city by its name from its outskirts', () => {
    // ~8 km de centrul Bucurestiului: un prag fix de 5 km ar fi scris "langa"
    const place = findNearestPlace(index, 44.5040, 26.1063)!;
    expect(place.name).toBe('București');
    expect(place.distanceKm).toBeGreaterThan(5);
    expect(formatPlace(place, 'ro', near)).toBe('București, România');
  });

  it('shows the place alone when the row carries no country', () => {
    const odd = parsePlaceIndex('Undeva\t44.11\t24.99\t\t900');
    const place = findNearestPlace(odd, 44.11, 24.99)!;
    expect(formatPlace(place, 'ro', near)).toBe('Undeva');
  });
});
