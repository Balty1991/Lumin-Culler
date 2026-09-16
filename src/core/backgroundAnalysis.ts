/**
 * core/backgroundAnalysis.ts
 * Analiza merge mai departe cu ecranul stins.
 *
 * Punte catre plugin-ul Capacitor local BackgroundAnalysis (vezi
 * android/app/src/main/java/com/luminculler/app/plugins/BackgroundAnalysisService.kt).
 *
 * DE CE. Singurul lucru pentru care auditul de dinaintea lansarii spune ca ar
 * plati un parinte: "pune telefonul in buzunar". La 2,46 s pe poza, o nunta de
 * 2000 de cadre inseamna ~82 de minute cu ecranul aprins — si exact atat cerea
 * aplicatia pana acum, prin core/wakeLock.ts. Cine incuia telefonul pierdea
 * importul la jumatate.
 *
 * CE E SI CE NU E. Analiza NU se muta in nativ; ramane in WebView, unde e
 * scrisa. Serviciul tine procesul in grupul de prim-plan (din Android 12
 * incoace, un proces ajuns in cache e INGHETAT si WebView-ul nu mai primeste
 * timp de procesor) si tine un lacat de procesor cu termen. Atat.
 *
 * ESECUL E MEREU TACUT. Un serviciu de prim-plan poate fi refuzat de sistem
 * (restrictii de pornire din fundal), permisiunea de notificari poate lipsi, sau
 * platforma poate fi web. In toate cazurile importul merge exact ca inainte —
 * doar ca se opreste daca omul incuie telefonul, adica fix comportamentul de
 * pana la runda asta. Nimic din fisierul asta n-are voie sa arunce.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { checkNotificationAccess, requestNotificationAccess } from './nativeNotifications';

interface BackgroundAnalysisApi {
  start(options: BackgroundAnalysisState): Promise<{ started: boolean; reason?: string }>;
  update(options: BackgroundAnalysisState): Promise<void>;
  stop(): Promise<void>;
  batteryUnrestricted(): Promise<{ available: boolean; unrestricted: boolean }>;
  openBatterySettings(): Promise<void>;
}

interface BackgroundAnalysisState {
  done: number;
  total: number;
  text?: string;
  /** `false` cere dunga fara sfarsit in locul barei reale — vezi backgroundPhaseNotice. */
  determinate?: boolean;
}

const BackgroundAnalysis = registerPlugin<BackgroundAnalysisApi>('BackgroundAnalysis');

/**
 * Sub atatea poze, serviciul nu merita pornit.
 *
 * Un import de cinci poze se termina in cateva secunde — omul se uita la ecran,
 * nu incuie telefonul. O notificare permanenta aparuta si disparuta in trei
 * secunde nu apara nimic si arata ca un gunoi. La 25 de poze, la 2,46 s
 * fiecare, vorbim deja de un minut, adica de timpul in care cineva chiar lasa
 * telefonul din mana.
 */
export const MIN_PHOTOS_FOR_BACKGROUND = 25;

/**
 * Cat de des se reimprospateaza notificarea, cel mult.
 *
 * Era "din 10 in 10 poze", si de-acolo venea jumatate din bug-ul raportat: la
 * 2,46 s pe poza inseamna un semn de viata la 25 de secunde, iar in fazele
 * care nu numara poze (pregatirea, gruparea) nu venea NICIUN semn. Omul vedea
 * o bara inghetata si credea ca s-a blocat analiza.
 *
 * Un prag de timp merge in toate fazele, indiferent cat de repede numara
 * fiecare. Iar costul e ce era si inainte, doar altfel asezat: un apel peste
 * punte si o notificare redesenata la doua secunde, langa secunde intregi de
 * lucru pe fiecare poza.
 */
export const BACKGROUND_NOTIFY_INTERVAL_MS = 2000;

/** Fazele importului, asa cum le raporteaza core/importPipeline.ts. */
export type BackgroundPhase = 'citire' | 'incarcare' | 'pregatire' | 'analiza' | 'grupare' | 'finalizat';

/**
 * Ce arata notificarea la faza asta: textul ca CHEIE i18n (ca sa se compuna in
 * limba aleasa de om, nu aici) si ce fel de bara i se potriveste.
 *
 * `null` inseamna "nu atinge notificarea": la 'finalizat' importul oricum
 * cheama `stopBackgroundAnalysis`, iar o ultima redesenare inainte sa dispara
 * ar fi doar palpaire.
 *
 * BARA REALA DOAR LA 'analiza'. Prima incercare a dat fiecarei faze bara ei, si
 * s-a vazut imediat pe telefon de ce e gresit: pregatirea umplea bara pana la
 * jumatate, apoi analiza o lua de la 2%. Bara mergea INAPOI — semnalul universal
 * pentru "s-a intamplat ceva rau, a luat-o de la capat". Singurul numar care
 * creste monoton de la zero pana la capatul importului e cel din analiza; restul
 * isi numara propriile lucruri, si merita dunga fara sfarsit, care spune exact
 * atat cat se stie: lucrez, nu pot spune cat mai e.
 */
export function backgroundPhaseNotice(
  phase: BackgroundPhase
): { key: string; determinate: boolean } | null {
  switch (phase) {
    case 'citire':
    case 'incarcare':
      return { key: 'store.background.starting', determinate: false };
    case 'pregatire':
      return { key: 'store.background.preparing', determinate: false };
    case 'analiza':
      return { key: 'store.background.progress', determinate: true };
    case 'grupare':
      return { key: 'store.background.grouping', determinate: false };
    default:
      return null;
  }
}

export function isBackgroundAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackgroundAnalysis');
}

/**
 * Declansatorul natural al permisiunii de notificari: chiar importul.
 *
 * Raportat de utilizator: daca inchizi ecranul de intampinare cu X fara sa
 * citesti, permisiunea de galerie tot apare, dar cea de notificari nu mai apare
 * NICIODATA. Butonul X cheama direct `dismissWelcome`, deci sare peste pasul
 * care o cerea — si ala era singurul loc din aplicatie care o cerea.
 *
 * Galeria n-avea problema asta fiindca are un declansator natural: prima citire
 * din galerie. Notificarile primesc acum unul la fel de firesc — momentul in
 * care porneste un import destul de lung cat sa lasi telefonul din mana. E si
 * singurul moment in care permisiunea chiar schimba ceva.
 *
 * Acopera si cazurile pe care ecranul de intampinare nu le poate acoperi
 * niciodata: cine a instalat o versiune mai veche si l-a vazut deja, si cine
 * inchide aplicatia la primul ecran.
 *
 * Se cere doar daca lipseste. Nu e nevoie de niciun steag tinut minte: dupa un
 * refuz definitiv, Android raspunde pe loc si fara dialog, deci nu exista
 * insistenta la fiecare import. Raspunsul nu se verifica — un refuz e o
 * alegere, iar analiza merge mai departe oricum, doar fara sa spuna cat a ajuns.
 */
async function ceriVoieDeNotificare(): Promise<void> {
  try {
    if (await checkNotificationAccess() === 'granted') return;
    await requestNotificationAccess();
  } catch {
    // Regula fisierului: nimic de aici n-are voie sa opreasca un import.
  }
}

/**
 * Porneste serviciul pentru un import. Intoarce `false` cand nu s-a putut —
 * apelantul nu trebuie sa faca nimic cu raspunsul in afara de a-l tine minte:
 * nu exista nicio cale de rezerva de incercat, si nu e nimic de spus omului
 * despre o functie care oricum nu i s-a promis in clipa aia.
 */
export async function startBackgroundAnalysis(done: number, total: number, text?: string): Promise<boolean> {
  if (!isBackgroundAnalysisAvailable()) return false;
  if (total < MIN_PHOTOS_FOR_BACKGROUND) return false;
  await ceriVoieDeNotificare();
  try {
    // `total` e aici pragul de pornire, nu o bara: la pornire nu s-a analizat
    // inca nicio poza, iar o bara reala goala e doar o bara care pare inghetata.
    const answer = await BackgroundAnalysis.start({ done, total, text, determinate: false });
    return answer.started === true;
  } catch {
    return false;
  }
}

/** Actualizeaza bara din notificare. Ieftina, dar nu gratuita — vezi apelantul pentru cat de des. */
export async function updateBackgroundAnalysis(
  done: number, total: number, text?: string, determinate = true
): Promise<void> {
  if (!isBackgroundAnalysisAvailable()) return;
  try {
    await BackgroundAnalysis.update({ done, total, text, determinate });
  } catch {
    // O bara de progres nereimprospatata nu opreste nimic.
  }
}

/**
 * Opreste serviciul si elibereaza lacatul.
 *
 * De chemat NECONDITIONAT, dintr-un `finally`: e sigur si cand serviciul n-a
 * pornit niciodata. Un lacat de procesor ramas in urma dupa un import esuat ar
 * fi cea mai proasta greseala posibila din tot fisierul — bateria goala, fara
 * nicio explicatie pentru om.
 */
export async function stopBackgroundAnalysis(): Promise<void> {
  if (!isBackgroundAnalysisAvailable()) return;
  try {
    await BackgroundAnalysis.stop();
  } catch {
    // Serviciul are si un termen pe lacat, tocmai pentru cazul asta.
  }
}

/**
 * Restrictia de baterie, ca stare: 'unrestricted' merge, 'restricted' inseamna
 * ca sistemul are voie sa opreasca lucrul in fundal, 'unknown' inseamna ca nu
 * avem de unde sti (web, sau plugin vechi).
 *
 * Raportat cu o captura: 82 din 87, oprit de SAPTE minute cat omul a stat in
 * alta aplicatie. Prioritatea randarii a scurtat blocajele de la minute la
 * secunde, dar peste ea sta managerul de baterie al producatorului, si el nu se
 * convinge din cod — doar din Setari, de mana omului.
 *
 * 'unrestricted' NU e o garantie si nu trebuie prezentat ca una: multe telefoane
 * au pe deasupra restrictii proprii (pornire automata, "economisire" per
 * aplicatie) despre care Android nu stie nimic.
 */
export type BatteryRestriction = 'unrestricted' | 'restricted' | 'unknown';

export async function readBatteryRestriction(): Promise<BatteryRestriction> {
  if (!isBackgroundAnalysisAvailable()) return 'unknown';
  try {
    const raspuns = await BackgroundAnalysis.batteryUnrestricted();
    if (!raspuns.available) return 'unknown';
    return raspuns.unrestricted ? 'unrestricted' : 'restricted';
  } catch {
    // Plugin mai vechi decat metoda (build instalat peste): nu stim, si "nu stim"
    // nu are voie sa arate ca o problema.
    return 'unknown';
  }
}

/** Deschide ecranul de unde se scoate restrictia. Nu cere nimic singura — vezi plugin. */
export async function openBatterySettings(): Promise<void> {
  if (!isBackgroundAnalysisAvailable()) return;
  try {
    await BackgroundAnalysis.openBatterySettings();
  } catch {
    // Un ecran de setari care nu se deschide nu are voie sa arunce in UI.
  }
}
