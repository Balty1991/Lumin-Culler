import { useState } from 'react';
import { useStore } from '../state/store';
import { isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { requestNotificationAccess, isNativeNotificationsAvailable } from '../core/nativeNotifications';
import { t } from '../i18n';

const STORAGE_KEY = 'lumin-setup-done';
const DAY_MS = 86_400_000;
/**
 * Varianta automată citește doar ultima săptămână. Raportat: cu 30 de zile
 * s-au adus singure 926 de poze (~10 minute), iar omul voia să aleagă el.
 */
const SETUP_DAYS = 7;

function readDone(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
function writeDone(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* fără stocare: reapare, nu strică nimic */ }
}

/**
 * ui/SetupFlow.tsx
 * Prima deschidere, după bun venit: „Să-ți construim AI-ul de sortare”.
 *
 * Raportat: „la început nu a apărut nicio configurare de a învăța AI-ul”.
 * Testul „Învață-mă” pornea abia după un import făcut de om, deci o aplicație
 * goală nu cerea nimic. Aici omul vede cei trei pași și îi pornește cu o
 * singură atingere: se citesc pozele din ultima lună (pe telefon), testul de
 * gust se deschide singur la final (ui/TasteQuiz.tsx), iar notificarea de
 * seară e cerută aici, unde are un motiv spus.
 */
export function SetupFlow({ onPickManually }: { onPickManually: () => void }) {
  const photos = useStore(s => s.photos);
  const progress = useStore(s => s.progress);
  const welcomeSeen = useStore(s => s.welcomeSeen);
  const locale = useStore(s => s.locale);
  const importGalleryPeriod = useStore(s => s.importGalleryPeriod);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const [done, setDone] = useState(readDone);
  const [starting, setStarting] = useState(false);

  if (done || !welcomeSeen || photos.length > 0 || progress) return null;

  const finish = () => { writeDone(); setDone(true); };
  const start = async () => {
    setStarting(true);
    finish();
    if (isNativeNotificationsAvailable()) void requestNotificationAccess().catch(() => {});
    const end = Date.now() + 1;
    await importGalleryPeriod({ start: end - SETUP_DAYS * DAY_MS, end });
  };
  const native = isNativeMediaLibraryAvailable();

  return (
    <div className="v3-screen v3-setup" role="dialog" aria-modal="true" aria-label={tr('setup.title')}>
      <div className="v3-screen-inner">
        <span className="v3-kicker">{tr('setup.kicker')}</span>
        <h2 className="v3-today-title">{tr('setup.title')}<br /><em>{tr('setup.titleAccent')}</em></h2>
        <p className="v3-setup-lead">{tr('setup.lead')}</p>

        <ol className="v3-setup-steps">
          <li><b className="v3-mono">01</b><div><strong>{tr('setup.step1.title')}</strong><span>{tr('setup.step1.body', { days: SETUP_DAYS })}</span></div></li>
          <li><b className="v3-mono">02</b><div><strong>{tr('setup.step2.title')}</strong><span>{tr('setup.step2.body')}</span></div></li>
          <li><b className="v3-mono">03</b><div><strong>{tr('setup.step3.title')}</strong><span>{tr('setup.step3.body')}</span></div></li>
        </ol>

        {/* Întâi alegi tu pozele (cerința utilizatorului); varianta automată e a doua. */}
        <button className="v3-cta" onClick={() => { finish(); onPickManually(); }} disabled={starting}>
          <span>{tr('setup.pick')}</span><span className="v3-mono">→</span>
        </button>
        {native && (
          <button className="v3-outline-btn" onClick={() => void start()} disabled={starting}>{tr('setup.auto', { days: SETUP_DAYS })}</button>
        )}
        <p className="v3-kicker v3-center">{tr('aiProfile.private')}</p>
      </div>
    </div>
  );
}
