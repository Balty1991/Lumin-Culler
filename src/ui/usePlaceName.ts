import { useEffect, useState } from 'react';
import { hasRealGps } from '../core/gpsCoordinates';
import { findNearestPlace, formatPlace, loadPlaceIndex } from '../core/placeNames';
import { useStore } from '../state/store';
import { t } from '../i18n';

/**
 * Localitatea in care a fost facuta poza — "Roșiori de Vede, România" — sau
 * `null` cat timp nu se stie.
 *
 * DOAR localitatea si tara, deliberat. Am avut si adrese exacte, cerute
 * serviciului de harti al telefonului, si le-am scos dupa o intrebare a
 * utilizatorului la care raspunsul cinstit a fost "nu se poate sti": strada e
 * ce ALEGE un serviciu pentru o coordonata care are ea insasi eroare de zeci-
 * sute de metri. Dovada, de pe telefonul lui: o poza dintr-o curte si alta
 * dintr-o piata publica, la kilometri distanta, primeau de la Galerie aceeasi
 * strada. Localitatea, in schimb, nu se schimba de la o eroare de sute de
 * metri — deci poate fi afirmata.
 *
 * Numele vine dintr-o lista inclusa in aplicatie (core/placeNames.ts): nu pleaca
 * nimic de pe telefon, nici macar coordonatele.
 */
export function usePlaceName(latitude: number | undefined, longitude: number | undefined): string | null {
  const locale = useStore(s => s.locale);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!hasRealGps(latitude, longitude)) return;
    let alive = true;
    void loadPlaceIndex().then(index => {
      if (!alive || !index) return;
      const place = findNearestPlace(index, latitude!, longitude!);
      if (place) setName(formatPlace(place, locale, near => t(locale, 'locations.near', { place: near })));
    });
    return () => { alive = false; };
  }, [latitude, longitude, locale]);
  return name;
}
