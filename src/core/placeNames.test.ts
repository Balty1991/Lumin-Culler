import { describe, it, expect } from 'vitest';
import { parsePlaceIndex, findNearestPlace, formatPlace } from './placeNames';

/** Exact formatul pe care il scrie pasul "Bundle place names" din CI: nume, lat, lon, tara. */
const SAMPLE = [
  'Roșiori de Vede\t44.1143\t24.9868\tRO',
  'București\t44.4323\t26.1063\tRO',
  'Alexandria\t43.9700\t25.3333\tRO',
  'Paris\t48.8534\t2.3488\tFR'
].join('\n');

const index = parsePlaceIndex(SAMPLE);
const near = (name: string) => `lângă ${name}`;

describe('parsePlaceIndex', () => {
  it('reads every complete row', () => {
    expect(index.names).toEqual(['Roșiori de Vede', 'București', 'Alexandria', 'Paris']);
    expect(index.latitudes[0]).toBeCloseTo(44.1143, 4);
    expect(index.countries[3]).toBe('FR');
  });

  it('skips broken rows instead of failing the whole list', () => {
    const broken = parsePlaceIndex(
      'Bun\t44.1\t24.9\tRO\nrand fara coloane\nAlt loc\tnu-i numar\t24.9\tRO\n\nAltul\t45.0\t25.0\tRO'
    );
    expect(broken.names).toEqual(['Bun', 'Altul']);
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

  it('returns nothing for an empty list', () => {
    expect(findNearestPlace(parsePlaceIndex(''), 44.1, 24.9)).toBeNull();
  });
});

describe('formatPlace', () => {
  it('names the place and the country', () => {
    const place = findNearestPlace(index, 44.11431, 24.98677)!;
    expect(formatPlace(place, 'ro', near)).toBe('Roșiori de Vede, România');
    expect(formatPlace(place, 'en', near)).toBe('Roșiori de Vede, Romania');
  });

  /**
   * Asezarile mici lipsesc din lista (GeoNames cities1000). Pentru ele se arata
   * cea mai apropiata localitate cunoscuta, dar MARCATA ca atare — altfel poza
   * dintr-un sat ar primi numele orasului vecin ca si cum ar fi sigur.
   */
  it('says "near" when the photo is not in the place itself', () => {
    const place = findNearestPlace(index, 44.30, 25.10)!;
    expect(place.distanceKm).toBeGreaterThan(5);
    expect(formatPlace(place, 'ro', near)).toMatch(/^lângă /);
  });

  it('shows the place alone when the row carries no country', () => {
    const odd = parsePlaceIndex('Undeva\t44.11\t24.99\t');
    const place = findNearestPlace(odd, 44.11, 24.99)!;
    expect(formatPlace(place, 'ro', near)).toBe('Undeva');
  });
});
