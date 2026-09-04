import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  readImportReminderSnoozedUntil, writeImportReminderSnoozedUntil, shouldShowImportReminder, IMPORT_REMINDER_SNOOZE_MS
} from '../state/importReminder';
import { readGalleryWatermark, worthMentioning } from '../state/galleryWatermark';
import { countGalleryPhotosSince, getPhotosAccess, isNativeMediaLibraryAvailable } from '../core/nativeMediaLibrary';
import { UploadIcon, XIcon } from './icons';
import { t, plural } from '../i18n';

/**
 * ui/ImportReminder.tsx
 * Memento periodic de reangajare — acum despre TELEFONUL tau, nu despre
 * aplicatie.
 *
 * Spunea "n-ai mai importat de ceva vreme". Comentariul de aici explica de ce:
 * un scanner de galerie "ar cere o permisiune noua, in contradictie cu
 * pozitionarea «acces minim»". Adevarat cand a fost scris, fals de mult timp —
 * aplicatia are READ_MEDIA_IMAGES si citeste chiar din MediaStore in
 * Supervizorul galeriei si in "Adu pe perioade". Mesajul ramasese pe semnalul
 * slab dintr-un motiv care nu mai exista.
 *
 * De ce conteaza: "n-ai mai importat de ceva vreme" e o propozitie despre
 * aplicatie, iar omul care n-a mai deschis-o de doua saptamani stie deja asta.
 * "Ai 312 poze noi de la ultimul triaj" e o propozitie despre telefonul lui, si
 * e singura care da un motiv sa apesi.
 *
 * TREI conditii ca sa apara cifra, si fiecare are un motiv:
 *  - permisiune COMPLETA. La acces limitat (Android 14+, "doar pozele alese")
 *    MediaStore arata doar pozele bifate atunci, deci numarul ar fi fals spus
 *    cu incredere — mai rau decat niciun numar.
 *  - un semn de carte deja pus (state/galleryWatermark.ts) — la prima folosire
 *    nu exista de unde numara.
 *  - destule poze noi cat sa merite. "Ai 3 poze noi" nu e un motiv sa deschizi
 *    o aplicatie de triaj; e o notificare care isi cauta un pretext.
 *
 * Daca oricare cade, ramane EXACT mesajul de dinainte. Nimic nu se cere si
 * nimic nu se strica: intrebarea se pune o singura data, abia dupa ce
 * memento-ul e deja hotarat sa apara, si nu ridica niciodata dialogul de
 * permisiuni (vezi countGalleryPhotosSince).
 *
 * Acelasi tipar ca BackupReminder: fara "nu mai arata niciodata" permanent
 * (revine periodic), doar amanare temporara.
 */
export function ImportReminder({ onAddPhotos }: { onAddPhotos: () => void }) {
  const locale = useStore(s => s.locale);
  const tr = (key: string, params?: Record<string, string | number>) => t(locale, key, params);
  const photos = useStore(s => s.photos);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);
  /** null = n-am aflat (fara permisiune, fara semn de carte, prea putine, sau inca nu s-a raspuns). */
  const [newPhotos, setNewPhotos] = useState<number | null>(null);

  const visible = useMemo(() => {
    if (hiddenThisSession) return false;
    const lastImportAt = photos.length ? Math.max(...photos.map(p => p.importedAt)) : null;
    return shouldShowImportReminder({
      now: Date.now(),
      lastImportAt,
      snoozedUntil: readImportReminderSnoozedUntil()
    });
  }, [hiddenThisSession, photos]);

  useEffect(() => {
    if (!visible || !isNativeMediaLibraryAvailable()) return;
    const watermark = readGalleryWatermark();
    if (watermark === null) return;
    let anulat = false;
    void (async () => {
      try {
        if (await getPhotosAccess() !== 'full') return;
        const { granted, count } = await countGalleryPhotosSince(watermark);
        if (!anulat && granted && worthMentioning(count)) setNewPhotos(count);
      } catch {
        // Un memento n-are voie sa arunce. Ramane mesajul general.
      }
    })();
    return () => { anulat = true; };
  }, [visible]);

  if (!visible) return null;

  const snooze = () => { writeImportReminderSnoozedUntil(Date.now() + IMPORT_REMINDER_SNOOZE_MS); setHiddenThisSession(true); };
  const addPhotos = () => { onAddPhotos(); setHiddenThisSession(true); };

  return (
    <div className="install-prompt" role="status">
      <div className="install-prompt-row">
        <UploadIcon className="install-prompt-icon" aria-hidden="true" />
        <span className="install-prompt-text mono">
          {newPhotos === null
            ? tr('app.importReminder.text')
            : tr(plural(newPhotos, 'app.importReminder.newPhotos.one', 'app.importReminder.newPhotos.other'), { count: newPhotos })}
        </span>
        <button className="ghost icon-btn install-prompt-close" onClick={snooze} aria-label={tr('app.importReminder.snooze')}>
          <XIcon />
        </button>
      </div>
      <button className="ghost small install-prompt-install" onClick={addPhotos}>
        {newPhotos === null ? tr('app.importReminder.addPhotos') : tr('app.importReminder.sortThem')}
      </button>
    </div>
  );
}
