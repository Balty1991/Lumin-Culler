import { useEffect, useState } from 'react';
import { hasRealGps } from '../core/gpsCoordinates';
import { resolvePlaceNames } from '../core/reverseGeocode';

/**
 * Numele localitatii pentru o pereche de coordonate, sau `null` cat timp nu se
 * stie (nici nu se poate afla, fara retea sau fara serviciu de geocodare).
 *
 * Cerinta directa a utilizatorului: unde se vede o locatie, sa scrie
 * localitatea, ca in Galeria telefonului, nu un cod GPS. Coordonatele raman
 * afisate dedesubt — sunt informatia exacta, si tot ele se deschid in harta.
 *
 * Interogarea se face o singura data pe loc si se tine minte local (vezi
 * core/reverseGeocode.ts, unde e explicat si ce anume pleaca de pe telefon).
 */
export function usePlaceName(latitude: number | undefined, longitude: number | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
    if (!hasRealGps(latitude, longitude)) return;
    let alive = true;
    const key = 'photo';
    void resolvePlaceNames([{ key, latitude: latitude!, longitude: longitude! }])
      .then(names => { if (alive) setName(names.get(key) ?? null); });
    return () => { alive = false; };
  }, [latitude, longitude]);
  return name;
}
