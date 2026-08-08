/**
 * core/nativeMediaLibrary.ts
 * Punte catre plugin-ul Capacitor local MediaLibrary (vezi android/app/src/main/
 * java/com/luminculler/app/plugins/MediaLibraryPlugin.kt) — selectie de poze cu
 * URI content:// PASTRAT (spre deosebire de <input type="file"> din WebView,
 * care preda doar bytes-ii fisierului si arunca URI-ul) si stergere ulterioara
 * prin dialogul de confirmare AL SISTEMULUI (MediaStore.createTrashRequest,
 * API 30+ — tehnic Cos de gunoi, nu stergere bruta, dar prezentata
 * utilizatorului ca definitiva, vezi MediaLibraryPlugin.kt pentru motiv) —
 * vezi state/store.ts:deleteRejectedPhotos.
 *
 * Doar Android nativ: pe web/PWA, "sterge din telefon" nu are sens (nu exista
 * fisier de sters, doar Blob-uri in IndexedDB) — apelantul trebuie sa verifice
 * isNativeMediaLibraryAvailable() inainte de a oferi actiunea in UI.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface MediaLibraryPluginApi {
  pickPhotos(): Promise<{ cancelled: boolean; photos: { uri: string; name: string }[] }>;
  deletePhotos(options: { uris: string[] }): Promise<{ cancelled: boolean }>;
}

const MediaLibraryNative = registerPlugin<MediaLibraryPluginApi>('MediaLibrary');

/** Sigur de apelat si pe web — registerPlugin() nu esueaza la incarcare, doar la apelul efectiv al unei metode. */
export function isNativeMediaLibraryAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('MediaLibrary');
}

export interface NativePickedPhoto {
  uri: string;
  name: string;
  file: File;
}

/**
 * Deschide selectorul nativ si intoarce (File, URI) pentru fiecare poza
 * aleasa — File-ul e citit prin Capacitor.convertFileSrc (expune URI-ul
 * content:// ca URL fetch-abil in WebView), nu printr-un plugin separat de
 * citire bytes, ca sa nu mai adaugam cod Kotlin doar pentru asta. Poze
 * ilizibile individual (permisiune revocata intre selectie si citire) sunt
 * ignorate, la fel ca in filePicker.ts:pickImportFiles — un singur fisier
 * picat nu trebuie sa arunce tot lotul.
 */
export async function pickNativePhotos(): Promise<NativePickedPhoto[]> {
  const result = await MediaLibraryNative.pickPhotos();
  if (result.cancelled || !result.photos.length) return [];
  const settled = await Promise.allSettled(
    result.photos.map(async p => {
      const response = await fetch(Capacitor.convertFileSrc(p.uri));
      const blob = await response.blob();
      const file = new File([blob], p.name, { type: blob.type });
      return { uri: p.uri, name: p.name, file };
    })
  );
  const photos: NativePickedPhoto[] = [];
  settled.forEach(r => {
    if (r.status === 'fulfilled') photos.push(r.value);
    else console.warn('Poza ilizibila din selectia nativa, ignorata:', r.reason);
  });
  return photos;
}

/**
 * Cere mutarea in Cosul de gunoi al telefonului (nu stergere definitiva —
 * recuperabile de acolo, fereastra tipica ~30-60 zile, gestionata de sistem)
 * prin dialogul de confirmare al sistemului. Intoarce `cancelled: true` daca
 * utilizatorul a refuzat in acel dialog SAU daca lista de URI-uri era goala —
 * apelantul nu trebuie sa trateze niciun caz ca eroare, doar promisiunea
 * respinsa inseamna ca cererea nici n-a putut fi pornita (ex. Android < 11).
 */
export async function deleteNativePhotos(uris: string[]): Promise<{ cancelled: boolean }> {
  if (!uris.length) return { cancelled: true };
  return MediaLibraryNative.deletePhotos({ uris });
}
