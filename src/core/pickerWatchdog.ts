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
 * Strategie: dupa ce se apeleaza fileRef.current?.click(), asteptam ca tab-ul
 * sa redevina vizibil (utilizatorul s-a intors din selectorul de fisiere), apoi
 * lasam un interval scurt pentru ca `change` sa ajunga normal — daca nu ajunge,
 * aratam un mesaj cu sfat practic (mai putine poze deodata / Galerie in loc de
 * Fisiere), in loc de nimic.
 */
const TIMEOUT_AFTER_VISIBLE_MS = 6000;

export interface PickerWatchdog {
  /** Apelat cand fisierele chiar ajung (change s-a declansat normal) — anuleaza avertizarea. */
  cancel: () => void;
}

export function armPickerWatchdog(onTimeout: () => void): PickerWatchdog {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    timeoutId = setTimeout(() => {
      if (!cancelled) onTimeout();
    }, TIMEOUT_AFTER_VISIBLE_MS);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    cancel: () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
