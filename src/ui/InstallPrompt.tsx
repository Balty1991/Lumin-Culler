import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { readInstallPromptDismissed, writeInstallPromptDismissed } from '../state/installPrompt';
import { ApertureIcon, DownloadIcon, XIcon } from './icons';
import { t } from '../i18n';

/** Evenimentul non-standard `beforeinstallprompt` (Chrome/Edge/Android) — nu e inca in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Banner discret "Adauga pe ecranul principal" — aplicatia e deja instalabila
 * tehnic (manifest + service worker, vite-plugin-pwa), dar fara UI propriu
 * browserul nu ofera nicio sugestie vizibila, mai ales pe mobil (unde e
 * folosita cel mai des, dupa feedback-ul din aceasta sesiune). Doar Chrome/
 * Edge/Android trimit `beforeinstallprompt` — pe iOS Safari nu exista acest
 * eveniment (instalarea ramane manuala, din meniul de distribuire), asa ca
 * bannerul pur si simplu nu apare acolo, nu incearca sa-l simuleze.
 */
export function InstallPrompt() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(readInstallPromptDismissed);

  useEffect(() => {
    if (isStandalone()) return;
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredEvent(null);
      writeInstallPromptDismissed();
      setDismissed(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferredEvent || dismissed) return null;

  const dismiss = () => { writeInstallPromptDismissed(); setDismissed(true); };

  const install = async () => {
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // indiferent de alegere (acceptat/refuzat), evenimentul e deja "ars" (poate fi
    // folosit o singura data) — ascundem bannerul, nu mai insistam la fiecare vizita
    setDeferredEvent(null);
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
