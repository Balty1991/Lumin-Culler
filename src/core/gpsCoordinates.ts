/**
 * core/gpsCoordinates.ts
 * "Are poza asta o locatie reala?" — o singura definitie, folosita de tot ce
 * atinge coordonate (parserul EXIF, decodorul RAW, importul, Calatoriile,
 * panoul de informatii).
 *
 * Bug real raportat de utilizator, cu captura: panoul unei poze arata
 * "Locatie GPS: 0.00000, 0.00000", iar "Calatorii" ramanea gol. Cauza:
 * incepand cu Android 10, cand sistemul REDACTEAZA locatia unei poze servite
 * unei aplicatii, de multe ori nu sterge tag-urile GPS din EXIF, ci le lasa pe
 * loc cu valoarea ZERO. Pentru cod, asta arata exact ca o coordonata citita cu
 * succes: gpsLatitude = 0 e un numar, nu `undefined`.
 *
 * Consecintele erau doua, amandoua tacute:
 *   1. Panoul de informatii afisa cu seriozitate 0.00000, 0.00000.
 *   2. state/trips.ts lua toate pozele ca fiind in acelasi loc (Golful Guineei,
 *      unde se intersecteaza ecuatorul cu meridianul zero), deci "acasa" iesea
 *      tot acolo, distanta fata de casa 0 km, si nicio calatorie nu trecea
 *      vreodata pragul.
 *
 * 0,0 e tratat ca "fara locatie", nu ca un loc: e in largul oceanului, unde nu
 * exista poza de facut, si e valoarea pe care o produc si alte aparate/programe
 * cand nu au avut fix GPS.
 */

/** true doar pentru o pereche de coordonate care poate desemna un loc real. */
export function hasRealGps(latitude: number | undefined, longitude: number | undefined): boolean {
  if (latitude === undefined || longitude === undefined) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  return latitude !== 0 || longitude !== 0;
}
