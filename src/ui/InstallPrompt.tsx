import { useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { readInstallPromptDismissed, writeInstallPromptDismissed } from '../state/installPrompt';
import { getInstallPromptEvent, subscribeInstallPromptEvent, consumeInstallPromptEvent } from '../core/installPromptEvent';
import { ApertureIcon, DownloadIcon, XIcon } from './icons';
import { t } from '../i18n';

/**
 * Banner discret "Adauga pe ecranul principal" — aplicatia e deja instalabila
 * tehnic (manifest + service worker, vite-plugin-pwa), dar fara UI propriu
 * browserul nu ofera nicio sugestie vizibila, mai ales pe mobil (unde e
 * folosita cel mai des, dupa feedback-ul din aceasta sesiune). Doar Chrome/
 * Edge/Android trimit `beforeinstallprompt` — pe iOS Safari nu exista acest
 * eveniment (instalarea ramane manuala, din meniul de distribuire), asa ca
 * bannerul pur si simplu nu apare acolo, nu incearca sa-l simuleze.
 *
 * Evenimentul e citit dintr-un modul comun (core/installPromptEvent.ts), nu
 * mai e captat local — dupa ce bannerul e inchis (X) ramane totusi o intrare
 * "Instaleaza aplicatia" in Meniu (MenuDrawer), cat timp evenimentul e
 * disponibil: un "nu mai arata asta" nu trebuie sa insemne "nu mai pot
 * instala niciodata din aplicatie".
 */
export function InstallPrompt() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const deferredEvent = useSyncExternalStore(subscribeInstallPromptEvent, getInstallPromptEvent);
  const [dismissed, setDismissed] = useState(readInstallPromptDismissed);
  const libraryEmpty = useStore(s => s.photos.length === 0);

  // Nu inainte de primul import. `beforeinstallprompt` poate sosi in primele
  // secunde ale primei vizite, iar bannerul aparea atunci peste ecranul gol —
  // adica exact peste "alege primele fotografii", singurul lucru pe care omul
  // are ce sa-l faca acolo. Ridicat in feedbackul de produs, si e corect:
  // "adauga pe ecranul principal" e o cerere care are sens dupa ce aplicatia a
  // aratat ce stie sa faca, nu inainte.
  if (!deferredEvent || dismissed || libraryEmpty) return null;

  const dismiss = () => { writeInstallPromptDismissed(); setDismissed(true); };

  const install = async () => {
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // indiferent de alegere (acceptat/refuzat), evenimentul e deja "ars" (poate fi
    // folosit o singura data) — ascundem bannerul, nu mai insistam la fiecare vizita
    consumeInstallPromptEvent();
    dismiss();
  };

  return (
    <div className="install-prompt" role="status">
      <div className="install-prompt-row">
        <ApertureIcon className="install-prompt-icon" aria-hidden="true" />
        <span className="install-prompt-text mono">{tr('app.installPrompt.text')}</span>
        <button className="ghost icon-btn install-prompt-close" onClick={dismiss} aria-label={tr('app.installPrompt.dismiss')}>
          <XIcon />
        </button>
      </div>
      <button className="ghost small install-prompt-install" onClick={() => void install()}>
        <DownloadIcon className="inline-icon" /> {tr('app.installPrompt.install')}
      </button>
    </div>
  );
}
