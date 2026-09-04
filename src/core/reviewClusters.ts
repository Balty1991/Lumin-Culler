import { DEFECT_SHARPNESS, DEFECT_EYES_OPEN_RATIO } from './importPipeline';

/**
 * core/reviewClusters.ts
 * Coada de verificat, grupata pe CAUZA — nu pe cat de greu e cazul.
 *
 * DE CE, dupa ce am cautat alte motoare de analiza si n-am gasit niciunul care
 * sa merite. Aplicatia masoara deja 71 de semnale per poza: claritate, ochi,
 * expunere, inclinarea orizontului, calitatea bokeh-ului, naturaletea tonului
 * pielii. Le strange apoi intr-UN scor si intr-o banda de dificultate
 * (state/reviewPlan.ts: usor / de comparat / greu).
 *
 * Banda spune cat de greu e cazul. Nu spune CE e in neregula. Iar omul care
 * vede "47 de verificat" nu are de unde sti daca il asteapta 47 de decizii
 * diferite sau aceeasi decizie de 30 de ori.
 *
 * De obicei e a doua. Pozele proaste dintr-un import vin in familii: o rafala
 * miscata, un grup in care cineva a clipit, o serie de cadre aproape identice.
 * Spuse ca familii, se rezolva dintr-un gest; spuse ca lista, se rezolva una
 * cate una.
 *
 * ZERO COST: nicio inferenta noua, niciun octet descarcat, nicio dependinta.
 * Doar semnale deja calculate, citite altfel. Cea mai buna imbunatatire pe care
 * am gasit-o cautand motoare noi a fost sa folosesc mai bine ce exista.
 *
 * ACELEASI PRAGURI CA MOTORUL, importate, nu copiate (DEFECT_SHARPNESS,
 * DEFECT_EYES_OPEN_RATIO): poza care intra in grupul "neclare" e exact poza
 * pentru care bara de claritate se face rosie in panoul de metrici. Doua praguri
 * diferite ar insemna doua pareri in aceeasi aplicatie.
 *
 * O POZA INTR-UN SINGUR GRUP, si e important: o poza miscata SI cu ochii
 * inchisi ar aparea in doua grupuri, iar suma grupurilor ar depasi numarul de
 * poze — un rezumat care nu se aduna e mai rau decat niciun rezumat. Se alege
 * cauza dominanta, in ordinea de mai jos.
 */

/** Ordinea conteaza: prima potrivire castiga. Vezi CAUSE_ORDER pentru de ce asta. */
export type ReviewCause = 'blurry' | 'eyesClosed' | 'series' | 'exposure' | 'other';

export interface ReviewCluster {
  cause: ReviewCause;
  photoIds: string[];
}

/** Ce citeste gruparea. Un subset din PhotoView — ca sa poata fi testata cu obiecte scrise de mana. */
export interface ClusterablePhoto {
  id: string;
  sharpness: number;
  exposure: number;
  faceCount: number;
  allEyesOpen: boolean;
  groupEyesOpenRatio?: number;
  groupId?: string;
  highlightClipping?: number;
  shadowClipping?: number;
}

/**
 * Sub atat din cadru ars sau infundat, expunerea e o problema in sine, nu o
 * chestiune de gust. Peste pragul asta se pierde informatie care NU se mai
 * recupereaza din editare — spre deosebire de o poza doar inchisa la ton.
 */
const CLIPPING_LIMIT = 0.12;

/**
 * ORDINEA CAUZELOR, si fiecare pozitie are un motiv:
 *
 *  1. `blurry` — o poza miscata nu se repara nicicum. Orice altceva ar fi in
 *     neregula la ea e irelevant: decizia e deja luata de fizica.
 *  2. `eyesClosed` — al doilea defect ireparabil, dar numai cand exista oameni
 *     in cadru. Se rezolva de obicei alegand alt cadru din aceeasi serie.
 *  3. `series` — nu e un defect, e o alegere: mai multe cadre ale aceluiasi
 *     moment, dintre care vrei unul. Vine dupa defecte, fiindca o serie in care
 *     toate cadrele sunt miscate nu e o alegere, e un teanc de rebuturi.
 *  4. `exposure` — recuperabila partial din editare, deci ultima intre
 *     probleme.
 *  5. `other` — restul: cazuri la limita fara un defect numit. Astea chiar
 *     cer ochiul omului, si e cinstit sa fie numite asa.
 */
const CAUSE_ORDER: ReviewCause[] = ['blurry', 'eyesClosed', 'series', 'exposure', 'other'];

/** Cauza dominanta a unei poze. Vezi CAUSE_ORDER pentru ordine. */
export function causeOf(photo: ClusterablePhoto, seriesIds: ReadonlySet<string>): ReviewCause {
  if (photo.sharpness < DEFECT_SHARPNESS) return 'blurry';
  if (photo.faceCount > 0) {
    // La un singur om, `allEyesOpen`; la grup, fractiunea — acelasi prag ca
    // motorul, ca sa nu existe doua definitii ale "ochilor inchisi".
    const inchisi = photo.groupEyesOpenRatio !== undefined
      ? photo.groupEyesOpenRatio < DEFECT_EYES_OPEN_RATIO
      : !photo.allEyesOpen;
    if (inchisi) return 'eyesClosed';
  }
  if (photo.groupId && seriesIds.has(photo.groupId)) return 'series';
  if ((photo.highlightClipping ?? 0) > CLIPPING_LIMIT || (photo.shadowClipping ?? 0) > CLIPPING_LIMIT) return 'exposure';
  return 'other';
}

/**
 * Grupeaza pozele de verificat pe cauza dominanta, cele mai mari grupuri intai.
 *
 * `series` se acorda doar cand grupul chiar are MAI MULT de un cadru in coada:
 * o poza singura cu un groupId nu e o alegere de facut, e doar o poza care se
 * intampla sa aiba o eticheta de serie.
 */
export function clusterReviewQueue(photos: readonly ClusterablePhoto[]): ReviewCluster[] {
  const perSerie = new Map<string, number>();
  for (const p of photos) {
    if (p.groupId) perSerie.set(p.groupId, (perSerie.get(p.groupId) ?? 0) + 1);
  }
  const seriiReale = new Set([...perSerie].filter(([, n]) => n > 1).map(([id]) => id));

  const grupuri = new Map<ReviewCause, string[]>();
  for (const p of photos) {
    const cauza = causeOf(p, seriiReale);
    (grupuri.get(cauza) ?? grupuri.set(cauza, []).get(cauza)!).push(p.id);
  }

  return CAUSE_ORDER
    .flatMap(cause => {
      const photoIds = grupuri.get(cause);
      return photoIds?.length ? [{ cause, photoIds }] : [];
    })
    // Cel mai mare grup primul: acolo e cea mai mare economie de gesturi. La
    // egalitate ramane ordinea cauzelor, care e deja motivata.
    .sort((a, b) => b.photoIds.length - a.photoIds.length);
}

/**
 * Merita aratat rezumatul? Nu pentru trei poze, si nu cand totul cade intr-un
 * singur grup — "47 de verificat, toate 47 neclare" e aceeasi informatie ca
 * "47 de verificat", spusa cu mai multe cuvinte.
 */
export const MIN_QUEUE_FOR_SUMMARY = 8;

export function worthSummarising(clusters: readonly ReviewCluster[]): boolean {
  const total = clusters.reduce((n, c) => n + c.photoIds.length, 0);
  return total >= MIN_QUEUE_FOR_SUMMARY && clusters.length > 1;
}
