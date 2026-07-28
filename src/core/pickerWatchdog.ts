/**
 * core/pickerWatchdog.ts
 * Plasa de siguranta pentru <input type="file">: pe unele telefoane, alegerea
 * mai multor poze mari deodata dintr-o aplicatie precum "Fisiere" (nu Galeria)
 * poate face ca evenimentul `change` sa NU mai ajunga niciodata la pagina —
 * confirmat pe teren (1 poza merge, 5 poze mari deodata nu se intampla nimic,
 * fara nicio eroare). E o limitare a telefonului/browserului la transferul de
 * continut intre aplicatii, nu ceva ce putem repara direct din JS — dar putem
 * macar sa nu lasam utilizatorul in tacere totala.
 *
 * Strategie in doua straturi:
 * 1. Cand tab-ul redevine vizibil/activ (visibilitychange SAU window focus —
 *    unele browsere declanseaza doar unul dintre ele), lasam un interval scurt
 *    pentru ca `change` sa ajunga normal.
 * 2. Plasa finala: un timer absolut, independent de orice eveniment de
 *    vizibilitate — confirmat pe teren ca Xiaomi Browser (MIUI) uneori NU
 *    declanseaza deloc nici visibilitychange, nici focus, la revenirea din
 *    selectorul de fisiere extern, ceea ce ar face stratul 1 complet inert
 *    acolo. Durata mult mai mare, ca sa nu deranjeze un utilizator care inca
 *    rasfoieste/alege poze in acel moment.
 */
const TIMEOUT_AFTER_VISIBLE_MS = 6000;
const ABSOLUTE_FALLBACK_MS = 45000;

export interface PickerWatchdog {
  /** Apelat cand fisierele chiar ajung (change s-a declansat normal) — anuleaza avertizarea. */
  cancel: () => void;
}

export function armPickerWatchdog(onTimeout: () => void): PickerWatchdog {
  let cancelled = false;
  let fired = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const fireOnce = () => {
    if (cancelled || fired) return;
    fired = true;
    onTimeout();
  };

  const onReturnedToPage = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onReturnedToPage);
    window.removeEventListener('focus', onReturnedToPage);
    timers.push(setTimeout(fireOnce, TIMEOUT_AFTER_VISIBLE_MS));
  };
  document.addEventListener('visibilitychange', onReturnedToPage);
  window.addEventListener('focus', onReturnedToPage);

  timers.push(setTimeout(fireOnce, ABSOLUTE_FALLBACK_MS));

  return {
    cancel: () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onReturnedToPage);
      window.removeEventListener('focus', onReturnedToPage);
      for (const t of timers) clearTimeout(t);
    }
  };
}
