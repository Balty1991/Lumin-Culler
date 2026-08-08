import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  readImportReminderSnoozedUntil, writeImportReminderSnoozedUntil, shouldShowImportReminder, IMPORT_REMINDER_SNOOZE_MS
} from '../state/importReminder';
import { UploadIcon, XIcon } from './icons';
import { t } from '../i18n';

/**
 * Memento periodic "n-ai mai sortat de mult" (plan freemium/reangajare) —
 * spre deosebire de un scanner de galerie (ar cere o permisiune noua, in
 * contradictie cu pozitionarea "acces minim" a aplicatiei), semnalul vine
 * STRICT din istoricul propriu al aplicatiei: cel mai recent
 * PhotoRecord.importedAt deja incarcat. Nu poate spune "ai N poze noi", doar
 * "a trecut mult timp de la ultimul import" — mai putin precis, dar gratuit.
 * Acelasi tipar ca BackupReminder: fara "nu mai arata niciodata" permanent
 * (revine periodic), doar amanare temporara.
 */
export function ImportReminder({ onAddPhotos }: { onAddPhotos: () => void }) {
  const locale = useStore(s => s.locale);
  const tr = (key: string) => t(locale, key);
  const photos = useStore(s => s.photos);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);

  const visible = useMemo(() => {
    if (hiddenThisSession) return false;
    const lastImportAt = photos.length ? Math.max(...photos.map(p => p.importedAt)) : null;
    return shouldShowImportReminder({
      now: Date.now(),
      lastImportAt,
      snoozedUntil: readImportReminderSnoozedUntil()
    });
  }, [hiddenThisSession, photos]);

  if (!visible) return null;

  const snooze = () => { writeImportReminderSnoozedUntil(Date.now() + IMPORT_REMINDER_SNOOZE_MS); setHiddenThisSession(true); };
  const addPhotos = () => { onAddPhotos(); setHiddenThisSession(true); };

  return (
    <div className="install-prompt" role="status">
      <div className="install-prompt-row">
        <UploadIcon className="install-prompt-icon" aria-hidden="true" />
        <span className="install-prompt-text mono">{tr('app.importReminder.text')}</span>
        <button className="ghost icon-btn install-prompt-close" onClick={snooze} aria-label={tr('app.importReminder.snooze')}>
          <XIcon />
        </button>
      </div>
      <button className="ghost small install-prompt-install" onClick={addPhotos}>
        {tr('app.importReminder.addPhotos')}
      </button>
    </div>
  );
}
