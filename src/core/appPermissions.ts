/**
 * core/appPermissions.ts
 * Drumul inapoi catre permisiuni, pentru cine a inchis ecranul de intampinare.
 *
 * DE CE EXISTA. Raportat de utilizator, dupa ce a incercat pe telefon: "la
 * prima instalare, daca dau x fara sa citesc, nu mai imi apare permisiuni de
 * notificare, doar cele de galerie". Exact asa: butonul X cheama direct
 * `dismissWelcome`, deci sare peste pasul care cerea permisiunea, si acela era
 * singurul ecran care o cerea. Galeria scapa fiindca are un declansator natural
 * — prima citire din galerie.
 *
 * Importul cere acum si el permisiunea de notificari la momentul potrivit (vezi
 * `ceriVoieDeNotificare` din core/backgroundAnalysis.ts), dar asta nu ajunge:
 * dupa un refuz, Android nu mai arata niciodata dialogul, iar singurul drum
 * ramas e Setarile sistemului — pe care nimeni nu le cauta din proprie
 * initiativa pentru o aplicatie care "pur si simplu nu face nimic". Cuvintele
 * utilizatorului: "sa le poata activa usor dupa".
 *
 * CE E 'unavailable' / 'unsupported'. NU o problema: inseamna ca permisiunea
 * aia nu exista pe platforma curenta (web/PWA n-are niciuna dintre ele). O
 * rubrica ce ar raporta "1 din 2" pe web ar inventa o problema inexistenta,
 * deci permisiunile neaplicabile nu se numara deloc.
 */
import { getPhotosAccess, openAppSettings, readGalleryOverview, type PhotosAccess } from './nativeMediaLibrary';
import {
  checkNotificationAccess, requestNotificationAccess, type NotificationAccess
} from './nativeNotifications';

export interface StarePermisiuni {
  galerie: PhotosAccess;
  notificari: NotificationAccess;
}

/**
 * ACCESUL LIMITAT SE NUMARA CA LIPSA, deliberat.
 *
 * Android 14+ evidentiaza vizual "Permite cu acces limitat", care e exact
 * alegerea gresita aici: se vad doar pozele bifate manual atunci, deci "Adu pe
 * perioade" si Supervizorul galeriei n-au ce citi. Pentru om aplicatia pare
 * stricata fara sa inteleaga de ce — vezi ui/PhotosAccessNotice.tsx, care
 * spune acelasi lucru in alt loc.
 */
function galerieEsteData(acces: PhotosAccess): boolean {
  return acces === 'full';
}

function galerieSeAplica(acces: PhotosAccess): boolean {
  return acces !== 'unavailable';
}

function notificariSeAplica(acces: NotificationAccess): boolean {
  return acces !== 'unsupported';
}

/** Cate permisiuni APLICABILE exista pe platforma asta, si cate dintre ele sunt date. */
export function numaraPermisiuni(stare: StarePermisiuni): { date: number; total: number } {
  let date = 0;
  let total = 0;
  if (galerieSeAplica(stare.galerie)) { total++; if (galerieEsteData(stare.galerie)) date++; }
  if (notificariSeAplica(stare.notificari)) { total++; if (stare.notificari === 'granted') date++; }
  return { date, total };
}

/** Are rost sa aratam rubrica? Pe web, unde nu se aplica niciuna, nu are. */
export function permisiuniRelevante(stare: StarePermisiuni): boolean {
  return numaraPermisiuni(stare).total > 0;
}

export function toatePermisiunileDate(stare: StarePermisiuni): boolean {
  const { date, total } = numaraPermisiuni(stare);
  return date === total;
}

export async function readAppPermissions(): Promise<StarePermisiuni> {
  const [galerie, notificari] = await Promise.all([
    getPhotosAccess().catch((): PhotosAccess => 'unavailable'),
    checkNotificationAccess().catch((): NotificationAccess => 'unsupported')
  ]);
  return { galerie, notificari };
}

/**
 * Cere ce lipseste, apoi spune daca a mai ramas ceva de reparat din Setari.
 *
 * Ordinea conteaza si e cea ieftina pentru om: intai dialogurile sistemului,
 * care se rezolva pe loc cu o apasare. Setarile sunt ULTIMA solutie, si doar
 * daca mai lipseste ceva dupa — dupa un refuz definitiv Android raspunde pe loc
 * si fara dialog, deci ajungem acolo exact cand chiar e singurul drum ramas.
 *
 * `readGalleryOverview` e ceruta pentru efectul ei: plugin-ul declanseaza
 * dialogul de galerie (`requestPermissionForAlias`) inainte sa citeasca. Nu
 * exista o metoda "cere si atat", si nici nu merita una — numaratoarea pe care o
 * intoarce e oricum ce afiseaza Supervizorul galeriei.
 *
 * Nu arunca niciodata: o rubrica de permisiuni care crapa aplicatia ar fi mai
 * rea decat permisiunea lipsa.
 */
export async function requestMissingPermissions(): Promise<{ stare: StarePermisiuni; complet: boolean }> {
  const inainte = await readAppPermissions();

  if (galerieSeAplica(inainte.galerie) && !galerieEsteData(inainte.galerie)) {
    await readGalleryOverview().catch(() => undefined);
  }
  if (notificariSeAplica(inainte.notificari) && inainte.notificari !== 'granted') {
    await requestNotificationAccess().catch(() => undefined);
  }

  const dupa = await readAppPermissions();
  return { stare: dupa, complet: toatePermisiunileDate(dupa) };
}

/**
 * Setarile sistemului, pentru ce nu se mai poate cere din aplicatie.
 * Reexportat de aici ca apelantul sa aiba un singur modul de permisiuni, nu doua.
 */
export { openAppSettings };
