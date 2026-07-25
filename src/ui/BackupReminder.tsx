import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  readLastBackupAt, readSnoozedUntil, writeSnoozedUntil, shouldShowBackupReminder, BACKUP_REMINDER_SNOOZE_MS
} from '../state/backupReminder';
import { DownloadIcon, XIcon } from './icons';
import { t } from '../i18n';

/**
 * Memento periodic pentru backup (plan "modernizare") — persoanele inrolate
 * si modelul AI invatat traiesc DOAR in acest browser (Dexie), fara sincronizare
 * cu niciun server; un `localStorage.clear()`/dezinstalare accidentala le
 * pierde definitiv. Spre deosebire de InstallPrompt, nu exista un "nu mai
 * arata niciodata" — riscul ramane real oricat de mult ar amana utilizatorul,
 * deci bannerul revine periodic (vezi shouldShowBackupReminder).
 */
export function BackupReminder() {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const persons = useStore(s => s.persons);
  const photos = useStore(s => s.photos);
  const exportBackup = useStore(s => s.exportBackup);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);

  const visible = useMemo(() => {
    if (hiddenThisSession) return false;
    const earliestActivityAt = photos.length ? Math.min(...photos.map(p => p.importedAt)) : null;
    return shouldShowBackupReminder({
      hasDataWorthBackingUp: persons.length > 0,
      now: Date.now(),
      lastBackupAt: readLastBackupAt(),
      snoozedUntil: readSnoozedUntil(),
      earliestActivityAt
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenThisSession, persons.length, photos.length]);

  if (!visible) return null;

  const snooze = () => { writeSnoozedUntil(Date.now() + BACKUP_REMINDER_SNOOZE_MS); setHiddenThisSession(true); };
  const backupNow = () => { void exportBackup(); setHiddenThisSession(true); };

  return (
    <div className="install-prompt" role="status">
      <DownloadIcon className="install-prompt-icon" aria-hidden="true" />
      <span className="install-prompt-text mono">{tr('app.backupReminder.text')}</span>
      <button className="ghost small install-prompt-install" onClick={backupNow}>
        {tr('app.backupReminder.backupNow')}
      </button>
      <button className="ghost icon-btn install-prompt-close" onClick={snooze} aria-label={tr('app.backupReminder.snooze')}>
        <XIcon />
      </button>
    </div>
  );
}
