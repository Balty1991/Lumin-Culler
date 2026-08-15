import { useEffect, useState } from 'react';
import { hasRealGps } from '../core/gpsCoordinates';
import { findNearestPlace, formatPlace, loadPlaceIndex } from '../core/placeNames';
import { useStore } from '../state/store';
import { t } from '../i18n';

/**
 * Numele localitatii pentru o pereche de coordonate, sau `null` cat timp nu se
 * stie.
 *
 * Cerinta directa a utilizatorului: unde se vede o locatie, sa scrie
 * localitatea, nu un cod GPS — dar fara ca ceva sa plece de pe telefon. Numele
 * vine dintr-o lista de localitati inclusa in aplicatie (vezi
 * core/placeNames.ts); coordonatele raman afisate, sunt informatia exacta.
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
