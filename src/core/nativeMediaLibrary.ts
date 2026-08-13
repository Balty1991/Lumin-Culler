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
  deletePhotos(options: { uris: string[] }): Promise<{ cancelled: boolean; skippedUris: string[] }>;
  galleryOverview(): Promise<{ granted: boolean; totalCount: number }>;
  galleryDateRange(): Promise<{ granted: boolean; earliestMs?: number; latestMs?: number }>;
  photosInRange(options: { startMs: string; endMs: string }): Promise<{ granted: boolean; photos: { uri: string; name: string; capturedAt: number }[] }>;
  galleryFolders(): Promise<{ granted: boolean; folders: { id: string; name: string; count: number }[] }>;
  photosInFolder(options: { bucketId: string }): Promise<{ granted: boolean; photos: { uri: string; name: string; capturedAt: number }[] }>;
  photosAccess(): Promise<{ access: PhotosAccess }>;
  openAppSettings(): Promise<void>;
}

/**
 * "limited" = Android 14+, utilizatorul a ales "Permite cu acces limitat" in
 * dialogul de permisiuni (optiunea pe care sistemul o si evidentiaza). Atunci
 * vedem DOAR pozele bifate manual atunci, deci tot ce citeste galeria ca intreg
 * — "Adu pe perioade", Supervizorul galeriei — nu are ce numara.
 */
export type PhotosAccess = 'full' | 'limited' | 'denied' | 'unavailable';

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
 *
 * `skippedUris` (bug real raportat de utilizator): unele URI-uri din lot pot
 * deveni neaccesibile intre import si stergere (ex. permisiunea "Acces la
 * fotografii selectate" pe Android 14+, revocata/schimbata intre timp) — vezi
 * MediaLibraryPlugin.kt:deletePhotos. Acestea sunt OMISE din cererea de
 * stergere (nu mai blocheaza intreg lotul care altfel ar fi esuat 100%), dar
 * returnate exact (URI-urile ORIGINALE, nu cele convertite intern) ca
 * apelantul (state/store.ts:deleteRejectedPhotos) sa NU le scoata din
 * biblioteca aplicatiei — tot mai exista pe telefon, doar n-au putut fi mutate
 * in Cosul de gunoi de data asta.
 */
export async function deleteNativePhotos(uris: string[]): Promise<{ cancelled: boolean; skippedUris: string[] }> {
  if (!uris.length) return { cancelled: true, skippedUris: [] };
  return MediaLibraryNative.deletePhotos({ uris });
}

/**
 * "Cate poze ai in galerie" (Acasa, plan modernizare) — cere permisiunea de
 * CITIRE a galeriei (READ_MEDIA_IMAGES/READ_EXTERNAL_STORAGE, prima data cand
 * se apeleaza asta) si intoarce DOAR un numar (MediaStore.query cu COUNT, fara
 * sa citeasca bytes-ii vreunei poze) — nu aduce nimic in aplicatie, doar
 * vizibilitate. Importul efectiv ramane strict prin pickNativePhotos() de mai sus.
 *
 * NEVALIDAT inca pe device real — vezi comentariul din MediaLibraryPlugin.kt.
 */
export async function readGalleryOverview(): Promise<{ granted: boolean; totalCount: number }> {
  return MediaLibraryNative.galleryOverview();
}

/**
 * "Supervizorul galeriei" (cerinta directa a utilizatorului: import pe
 * perioade cronologice, cele mai vechi intai) — vezi state/gallerySupervisor.ts
 * si MediaLibraryPlugin.kt:galleryDateRange (NEVALIDAT inca pe device real).
 * earliestMs/latestMs absente = galerie goala sau fara nicio poza cu data cunoscuta.
 */
export async function readGalleryDateRange(): Promise<{ granted: boolean; earliestMs?: number; latestMs?: number }> {
  return MediaLibraryNative.galleryDateRange();
}

export interface RangePickedPhoto {
  uri: string;
  name: string;
  capturedAt: number;
  file: File;
}

/**
 * Aduce DIRECT (fara selector manual) pozele din galerie cu data efectiva in
 * [startMs, endMs) — vezi MediaLibraryPlugin.kt:photosInRange. Aceeasi
 * conversie File prin Capacitor.convertFileSrc ca pickNativePhotos() de mai
 * sus; poze ilizibile individual sunt ignorate, nu opresc tot lotul.
 */
export async function pickPhotosInRange(startMs: number, endMs: number): Promise<RangePickedPhoto[]> {
  const result = await MediaLibraryNative.photosInRange({ startMs: String(startMs), endMs: String(endMs) });
  if (!result.granted || !result.photos.length) return [];
  const settled = await Promise.allSettled(
    result.photos.map(async p => {
      const response = await fetch(Capacitor.convertFileSrc(p.uri));
      const blob = await response.blob();
      const file = new File([blob], p.name, { type: blob.type });
      return { uri: p.uri, name: p.name, capturedAt: p.capturedAt, file };
    })
  );
  const photos: RangePickedPhoto[] = [];
  settled.forEach(r => {
    if (r.status === 'fulfilled') photos.push(r.value);
    else console.warn('Poza ilizibila din perioada ceruta, ignorata:', r.reason);
  });
  return photos;
}

/**
 * Foldere din galerie (bucket-uri MediaStore, ex. "Camera", "WhatsApp Images")
 * — cerinta directa a utilizatorului: alternativa la segmentarea cronologica.
 * Vezi MediaLibraryPlugin.kt:galleryFolders (NEVALIDAT inca pe device real).
 */
export async function readGalleryFolders(): Promise<{ granted: boolean; folders: { id: string; name: string; count: number }[] }> {
  return MediaLibraryNative.galleryFolders();
}

/** Aduce DIRECT toate pozele dintr-un folder — vezi pickPhotosInRange mai sus pentru acelasi tipar de conversie File. */
export async function pickPhotosInFolder(bucketId: string): Promise<RangePickedPhoto[]> {
  const result = await MediaLibraryNative.photosInFolder({ bucketId });
  if (!result.granted || !result.photos.length) return [];
  const settled = await Promise.allSettled(
    result.photos.map(async p => {
      const response = await fetch(Capacitor.convertFileSrc(p.uri));
      const blob = await response.blob();
      const file = new File([blob], p.name, { type: blob.type });
      return { uri: p.uri, name: p.name, capturedAt: p.capturedAt, file };
    })
  );
  const photos: RangePickedPhoto[] = [];
  settled.forEach(r => {
    if (r.status === 'fulfilled') photos.push(r.value);
    else console.warn('Poza ilizibila din folderul cerut, ignorata:', r.reason);
  });
  return photos;
}

/**
 * Ce fel de acces la galerie avem acum. 'unavailable' pe web/PWA si pe orice
 * versiune de plugin fara metoda asta (build vechi instalat peste) — apelantul
 * trebuie sa trateze cazul acela ca "nu stiu", nu ca pe o problema.
 */
export async function getPhotosAccess(): Promise<PhotosAccess> {
  if (!isNativeMediaLibraryAvailable()) return 'unavailable';
  try {
    return (await MediaLibraryNative.photosAccess()).access;
  } catch {
    return 'unavailable';
  }
}

/**
 * Deschide setarile aplicatiei. Dupa ce s-a ales o data "acces limitat",
 * sistemul nu mai arata dialogul, deci asta e singurul drum inapoi la acces
 * complet — fara el, sfatul "schimba permisiunea" ar fi corect si complet
 * neurmaribil.
 */
export async function openAppSettings(): Promise<void> {
  if (!isNativeMediaLibraryAvailable()) return;
  try {
    await MediaLibraryNative.openAppSettings();
  } catch (err) {
    console.error('Nu am putut deschide setarile aplicatiei:', err);
  }
}
