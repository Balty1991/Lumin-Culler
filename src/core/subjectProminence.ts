/**
 * core/subjectProminence.ts
 * "Exista un SUBIECT uman in cadru", nu doar "s-a detectat o fata".
 *
 * Extras intr-un modul propriu, fara nicio dependinta (nici db.ts, nici i18n,
 * nici @vladmandic/human) — exact acelasi motiv ca la sceneClassifier.ts: aceeasi
 * regula trebuie sa fie identica in faceAnalysis.worker.ts (web), in
 * ContextEngine si in portul Kotlin (ImageAnalysisPlugin.kt), fara ca vreunul
 * dintre ei sa traga in bundle graful celorlalti.
 *
 * De ce exista: un trecator la 30 de metri dintr-o poza de peisaj e o fata
 * detectata, iar codul trata `faces.length > 0` drept "fotografia asta e despre
 * oameni". Consecintele, toate reale, toate pe acelasi cadru de peisaj cu un om
 * mic in el:
 *  - compozitia era judecata dupa pozitia capului acelui om (treimi + headroom),
 *    in loc de linii directoare / simetrie / spatiu negativ;
 *  - focusul si bokeh-ul se masurau pe regiunea fetei lui — cateva zeci de
 *    pixeli, adica o masuratoare instabila care intra apoi si in claritatea
 *    finala prin blendSubjectSharpness;
 *  - cautarea obiectului principal (CenterNet) era sarita cu totul;
 *  - inclinarea orizontului nu se mai calcula deloc;
 *  - iar in ContextEngine se dezactiva landscapeSharpness, compensarea scrisa
 *    anume pentru ca perspectiva atmosferica inmoaie natural planurile
 *    indepartate (dupa o poza de munte respinsa pe nedrept).
 *
 * Ce NU schimba: expresiile, ochii, identitatea persoanelor. Fata mica ramane o
 * fata detectata si masurata — doar ca nu mai decide cum e judecat cadrul in
 * ansamblu.
 */

/** Cutie normalizata [x, y, latime, inaltime], fractiuni din cadru — ca FaceInsight.box. */
export type NormalizedBox = readonly [number, number, number, number];

/**
 * Aria minima a unei fete (fractiune din aria cadrului) de la care fotografia e
 * considerata a fi DESPRE acea persoana. 0.004 inseamna o fata cu latura de ~6%
 * din latura cadrului — la 4000px, o fata de ~250px: perfect vizibila, dar clar
 * un trecator, nu subiectul.
 *
 * Prag euristic, NECALIBRAT pe un set real de poze. Raul e mic in ambele
 * directii (prea mare: un portret de mediu e judecat ca peisaj; prea mic: bug-ul
 * de mai sus persista), dar merita recalibrat dupa testare pe device.
 */
export const MIN_SUBJECT_FACE_AREA = 0.004;

function area(box: NormalizedBox): number {
  return box[2] * box[3];
}

/** Fetele destul de mari cat sa fie subiectul fotografiei. */
export function prominentFaces<T extends { box: NormalizedBox }>(faces: readonly T[]): T[] {
  return faces.filter(f => area(f.box) >= MIN_SUBJECT_FACE_AREA);
}

/** Exista cel putin o fata destul de mare cat fotografia sa fie despre ea. */
export function hasProminentFace(faces: readonly { box: NormalizedBox }[]): boolean {
  return faces.some(f => area(f.box) >= MIN_SUBJECT_FACE_AREA);
}

/**
 * Cat de mult ocupa subiectul principal din cadru, 0..1 — latura fetei celei mai
 * mari raportata la jumatate din latura cadrului (o fata care acopera jumatate
 * din latura cadrului = 1). null cand nu exista nicio cutie de fata.
 *
 * Lipsea complet ca semnal: `faceScore` e increderea DETECTIEI, iar
 * ruleOfThirds/headroom descriu POZITIA — niciunul nu spune cat de mare e omul
 * in poza. Un portret in care fata umple cadrul si o poza in care aceeasi
 * persoana e un punct in departare arata identic pentru motor, desi sunt doua
 * fotografii complet diferite. Radacina patrata, nu aria bruta: aria scade cu
 * patratul, deci o scala liniara e mult mai aproape de cum percepem "mare in cadru".
 */
export function subjectProminence(faces: readonly { box: NormalizedBox }[]): number | null {
  let maxArea = 0;
  for (const f of faces) maxArea = Math.max(maxArea, area(f.box));
  if (maxArea <= 0) return null;
  return Math.min(1, Math.sqrt(maxArea) / 0.5);
}
