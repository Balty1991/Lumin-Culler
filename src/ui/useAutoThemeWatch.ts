import { useEffect } from 'react';
import { useStore } from '../state/store';

/**
 * ui/useAutoThemeWatch.ts
 * Tine tema sincronizata cat timp preferinta e "Automat" — reaplica periodic
 * (pragul orar 7:00/20:00 din state/theme.ts) si imediat ce sistemul insusi
 * comuta pe intunecat/luminos.
 *
 * De ce sta separat, si nu in MenuDrawer, unde a fost scris: era singurul motiv
 * pentru care meniul trebuia sa ramana montat de la pornirea aplicatiei. Meniul
 * e cea mai mare componenta de UI incarcata neconditionat (~50 KB de cod brut,
 * masurat in bundle-ul principal) pentru un panou pe care multi utilizatori
 * nu-l deschid deloc intr-o sesiune — dar nu putea fi mutat pe incarcare la
 * cerere cat timp ceasul temei atarna de el.
 *
 * Efectul e IDENTIC cu cel dinainte, doar ca acum se monteaza singur, din App,
 * si costa cateva linii in loc de tot meniul.
 *
 * Cele doua surse sunt amandoua necesare, nu una in plus:
 * - intervalul prinde trecerea pragului orar intr-o sesiune lasata deschisa;
 * - `prefers-color-scheme` prinde comutarea sistemului, care se poate intampla
 *   in orice clipa (pe Android/iOS tema intunecata poate fi programata la apus
 *   sau comutata din centrul de notificari). Fara abonament, aplicatia ar fi
 *   ramas pe tema veche pana la urmatoarea bifa de 15 minute — vizibil gresita,
 *   chiar langa restul sistemului deja comutat.
 */
const RECHECK_MS = 15 * 60 * 1000;

export function useAutoThemeWatch(): void {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  useEffect(() => {
    if (theme !== 'auto') return;
    const id = setInterval(() => setTheme('auto'), RECHECK_MS);
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onSystemChange = () => setTheme('auto');
    media?.addEventListener('change', onSystemChange);
    return () => {
      clearInterval(id);
      media?.removeEventListener('change', onSystemChange);
    };
  }, [theme, setTheme]);
}
