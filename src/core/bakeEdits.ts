/**
 * core/bakeEdits.ts
 * "Aplică editările" — coace ajustarile in imaginile pastrate, definitiv.
 *
 * De ce e nevoie, desi editarile SE SALVEAZA deja: ele se pastreaza ca NUMERE
 * (PhotoRecord.edits) si se aplica la afisare, de fiecare data, peste
 * miniatura originala. Merge pentru orice slider... in afara de bokeh.
 *
 * Bokeh-ul are nevoie de MASCA persoanei, iar masca e un element de DOM: nu
 * poate fi scrisa in IndexedDB (structured clone n-o poate clona) si nici nu
 * merita — se reface din poza. Consecinta pe care a observat-o utilizatorul:
 * pui bokeh, iesi din editor, si poza arata neatinsa. Nu pentru ca editarea
 * s-ar fi pierdut, ci pentru ca grila n-are cu ce reface efectul.
 *
 * Ce face coacerea: randeaza ajustarile O DATA, scrie rezultatul peste
 * miniatura si previzualizare, si duce ajustarile inapoi la neutru. Fara ultimul
 * pas s-ar aplica A DOUA OARA peste imaginea deja coapta.
 *
 * Ce NU se atinge: fisierul ORIGINAL, pastrat byte-cu-byte (db.originals).
 * De-aia operatia nu e o pierdere definitiva — originalul ramane acolo, iar
 * exportul "format original" il foloseste pe el.
 */
import { db } from './db';
import { applyAdjustmentsToBlob, isNeutral, NEUTRAL_ADJUSTMENTS, type EditAdjustments } from './imageAdjust';

/** Calitatea JPEG la re-encodare. Aceeasi ca la generarea initiala a previzualizarii. */
const BAKE_QUALITY = 0.9;

export interface BakeResult {
  /** Ce s-a rescris efectiv — pentru mesajul catre om si pentru teste. */
  thumbnail: boolean;
  preview: boolean;
}

/**
 * `extra` exista pentru bokeh: masca traieste doar in editor, deci trebuie
 * data din afara. Fara ea, coacerea unei poze cu bokeh ar pierde exact efectul
 * pentru care se coace.
 */
export async function bakeEdits(
  photoId: string,
  adjustments: EditAdjustments,
  extra?: Partial<EditAdjustments>
): Promise<BakeResult> {
  const complet: EditAdjustments = { ...adjustments, ...extra };
  if (isNeutral(complet)) return { thumbnail: false, preview: false };

  const [thumb, preview] = await Promise.all([
    db.thumbnails.get(photoId),
    db.previews.get(photoId)
  ]);

  const coapte = await Promise.all([
    thumb ? applyAdjustmentsToBlob(thumb.blob, complet, BAKE_QUALITY) : null,
    preview ? applyAdjustmentsToBlob(preview.blob, complet, BAKE_QUALITY) : null
  ]);

  // O singura tranzactie: daca se intrerupe la mijloc, nu ramane o poza cu
  // miniatura coapta si previzualizare necoapta — ar arata diferit in grila
  // fata de ecranul de detaliu, fara nicio explicatie.
  await db.transaction('rw', db.thumbnails, db.previews, db.photos, async () => {
    if (thumb && coapte[0]) await db.thumbnails.put({ ...thumb, blob: coapte[0] });
    if (preview && coapte[1]) await db.previews.put({ ...preview, blob: coapte[1] });
    // Ajustarile pleaca la neutru: sunt acum IN imagine, si aplicate din nou
    // peste ea s-ar dubla.
    await db.photos.update(photoId, { edits: { ...NEUTRAL_ADJUSTMENTS } });
  });

  return { thumbnail: !!(thumb && coapte[0]), preview: !!(preview && coapte[1]) };
}
