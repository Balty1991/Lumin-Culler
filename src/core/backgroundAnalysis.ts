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

interface BackgroundAnalysisApi {
  start(options: { done: number; total: number; text?: string }): Promise<{ started: boolean; reason?: string }>;
  update(options: { done: number; total: number; text?: string }): Promise<void>;
  stop(): Promise<void>;
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

export function isBackgroundAnalysisAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackgroundAnalysis');
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
  try {
    const answer = await BackgroundAnalysis.start({ done, total, text });
    return answer.started === true;
  } catch {
    return false;
  }
}

/** Actualizeaza bara din notificare. Ieftina, dar nu gratuita — vezi apelantul pentru cat de des. */
export async function updateBackgroundAnalysis(done: number, total: number, text?: string): Promise<void> {
  if (!isBackgroundAnalysisAvailable()) return;
  try {
    await BackgroundAnalysis.update({ done, total, text });
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
