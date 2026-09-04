/**
 * state/galleryWatermark.ts
 * Pana unde a vazut aplicatia galeria telefonului — semnul de carte dupa care
 * se poate spune "ai 312 poze noi", nu doar "a trecut mult timp".
 *
 * DE CE EXISTA, si de ce abia acum. Memento-ul de reangajare
 * (state/importReminder.ts) spunea, in comentariul lui: "nu exista nicio
 * citire a galeriei telefonului (ar cere o permisiune noua, in contradictie cu
 * pozitionarea «acces minim» a aplicatiei)". Adevarat cand a fost scris. Intre
 * timp aplicatia a capatat READ_MEDIA_IMAGES si citeste chiar din MediaStore
 * in doua functii intregi — Supervizorul galeriei si "Adu pe perioade". Deci
 * mesajul ramasese pe un semnal mai slab decat cel disponibil, dintr-un motiv
 * care nu mai era valabil.
 *
 * Diferenta nu e cosmetica. "N-ai mai importat de ceva vreme" e o propozitie
 * despre APLICATIE, si un om care n-a mai deschis-o de doua saptamani stie
 * deja asta. "Ai 312 poze noi de la ultimul triaj" e o propozitie despre
 * TELEFONUL LUI, si e singura care da un motiv sa apesi.
 *
 * CUM: la fiecare import incheiat se retine cea mai noua data din galerie IN
 * ACEL MOMENT (readGalleryDateRange().latestMs — functie deja folosita de
 * Supervizor, cu tot cu rezerva DATE_ADDED pentru pozele fara DATE_TAKEN).
 * Data aia devine semnul de carte. Pozele noi sunt cele de dupa el.
 *
 * CE NU FACE, deliberat:
 *  - nu cere permisiunea de galerie. Daca nu e deja data, nu exista semn de
 *    carte, nu exista numar, si memento-ul ramane exact cel de dinainte. O
 *    aplicatie care ridica un dialog de permisiuni fara ca omul sa fi cerut
 *    ceva e exact ce aplicatia asta nu vrea sa fie.
 *  - nu se atinge de accesul LIMITAT (Android 14+, "doar pozele alese").
 *    Acolo MediaStore arata doar pozele bifate manual atunci, deci un numar
 *    calculat pe el ar fi o cifra falsa spusa cu incredere — mai rau decat
 *    nicio cifra. Vezi PhotosAccess in core/nativeMediaLibrary.ts.
 *  - nu numara nimic in fundal si nu porneste nimic singur: intrebarea se pune
 *    o data, cand memento-ul chiar e pe cale sa apara.
 */

const WATERMARK_KEY = 'lumin-gallery-watermark';

/**
 * Acelasi tipar de citire ca importReminder.ts/modelLoadTiming.ts, si din
 * acelasi motiv: `Number(raw)` da NaN pentru orice gunoi din localStorage, iar
 * NaN trece de o garda `!== null` si abia apoi face fiecare comparatie falsa —
 * adica limita pazita dispare in tacere. Aici efectul ar fi fost sa numaram
 * poze "de la NaN incoace", deci niciuna.
 */
export function readGalleryWatermark(): number | null {
  try {
    const raw = localStorage.getItem(WATERMARK_KEY);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeGalleryWatermark(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    localStorage.setItem(WATERMARK_KEY, String(Math.floor(ms)));
  } catch {
    // stocare indisponibila — data viitoare memento-ul spune varianta fara numar
  }
}

/**
 * Semnul de carte NU merge inapoi.
 *
 * Poate parea exces de prudenta, dar e cazul obisnuit, nu unul exotic: cineva
 * importa "Iulie" din Supervizorul galeriei, iar cea mai noua poza ADUSA e din
 * iulie, desi galeria are poze de ieri. Daca semnul de carte ar lua data
 * ultimei poze aduse, ar cobori — si aplicatia ar anunta ca noi cateva sute de
 * poze pe care tocmai le-a aratat. Semnul de carte raspunde la "pana unde am
 * VAZUT galeria", nu la "ce am adus ultima data".
 */
export function advanceGalleryWatermark(latestMs: number | undefined): void {
  if (latestMs === undefined) return;
  const current = readGalleryWatermark();
  if (current !== null && latestMs <= current) return;
  writeGalleryWatermark(latestMs);
}

/**
 * Sub atatea poze noi, cifra nu spune nimic pe care sa merite sa-l spui: "ai 3
 * poze noi" nu e un motiv sa deschizi o aplicatie de triaj, si e mai rau decat
 * mesajul general, fiindca suna a notificare care cauta un pretext.
 */
export const MIN_NEW_PHOTOS_TO_MENTION = 25;

export function worthMentioning(count: number): boolean {
  return count >= MIN_NEW_PHOTOS_TO_MENTION;
}
