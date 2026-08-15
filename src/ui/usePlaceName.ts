import { useEffect, useState } from 'react';
import { hasRealGps } from '../core/gpsCoordinates';
import { resolvePlaceLabels } from '../core/placeLookup';
import { useStore } from '../state/store';
import { t } from '../i18n';

/**
 * Numele locului pentru o pereche de coordonate, sau `null` cat timp nu se
 * stie.
 *
 * Ce anume scrie depinde de alegerea utilizatorului (vezi core/placeLookup.ts):
 * implicit localitatea din lista inclusa in aplicatie, fara sa plece nimic; cu
 * "Adrese exacte" pornit, adresa completa de la serviciul de harti al
 * telefonului. Coordonatele raman afisate in ambele cazuri — ele sunt
 * informatia exacta, scrisa in poza de aparat.
 */
export function usePlaceName(latitude: number | undefined, longitude: number | undefined): string | null {
  const locale = useStore(s => s.locale);
  const onlinePlaceNames = useStore(s => s.onlinePlaceNames);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!hasRealGps(latitude, longitude)) return;
    let alive = true;
    const key = 'photo';
    void resolvePlaceLabels(
      [{ key, latitude: latitude!, longitude: longitude! }],
      locale,
      near => t(locale, 'locations.near', { place: near })
    ).then(labels => { if (alive) setName(labels.get(key) ?? null); });
    return () => { alive = false; };
  }, [latitude, longitude, locale, onlinePlaceNames]);
  return name;
}
