/**
 * core/faceEngine.ts
 * CARE model raspunde la "cine e in cadru si ce face", pe Android.
 *
 * DOUA CAI, si de ce exista amandoua.
 *
 * 'mlkit' (implicit, calea de pana acum): ML Kit FaceDetection da casetele,
 * zambetul si ochii, iar MediaPipe FaceLandmarker ruleaza SEPARAT, pe pozele
 * unde ML Kit a gasit ceva, doar pentru semnalele fine (zambet autentic,
 * contact vizual) — agregate pe grup, fiindca cele doua liste de fete nu se pot
 * potrivi 1:1.
 *
 * 'landmarker' (ce cere e7 din auditul motoarelor): un singur model face tot.
 * FaceLandmarker da si casetele (min/max peste cele 478 de puncte), si
 * zambetul (blendshape-uri), si ochii (EAR din mesh). Dispare cel mai scump
 * apel de pe telefon — ML Kit in PERFORMANCE_MODE_ACCURATE, masurat la 33% din
 * timpul unei poze — si dispare si problema corespondentei: fiind un singur
 * detector, semnalele fine ajung in sfarsit PER FATA, nu doar ca medie pe grup.
 *
 * CE NU E O NECUNOSCUTA. Scara noua nu e inventata acum: e chiar scara pe care
 * build-ul WEB o foloseste dintotdeauna. faceAnalysis.worker.ts calculeaza
 * `smile` din emotion.happy, `eyesOpen` din EAR normalizat cu (ear-0.08)/0.25 si
 * `isBlinking` cu acelasi BLINK_EAR_THRESHOLD de 0.18 — iar FaceMeshMath.kt e
 * portul 1:1 al acelorasi formule. Trecerea pe 'landmarker' aliniaza Androidul
 * la web, nu introduce o a treia scara. De-aia pragurile de mai jos sunt copiate
 * din worker, nu alese aici.
 *
 * CE RAMANE O NECUNOSCUTA, si de ce comutatorul porneste STINS. O biblioteca
 * deja triata contine poze scorate pe cealalta cale. Intr-o serie amestecata,
 * "cel mai bun cadru" ar compara doua scari — si asta nu da nicio eroare, da
 * un raspuns plauzibil si gresit. De-aia fiecare analiza isi poarta motorul in
 * AnalysisRecord.faceEngine, si de-aia schimbarea comutatorului cere o
 * re-analiza a bibliotecii (exista deja, in Meniu). Cu 12 testeri care se uita
 * acum la scoruri, treaba asta se aprinde dupa o verificare pe telefon, nu
 * intr-un commit.
 */

export type FaceEngine = 'mlkit' | 'landmarker';

const STORAGE_KEY = 'lumin-face-engine';

/**
 * Pragul de clipit, pe scara EAR normalizata.
 *
 * Copiat, nu ales: BLINK_EAR_THRESHOLD = 0.18 trecut prin aceeasi normalizare
 * ca masuratoarea, (ear - 0.08) / 0.25 — vezi
 * BLINK_EAR_THRESHOLD_NORMALIZED in workers/faceAnalysis.worker.ts si
 * FaceMeshMath.eyeOpenness in Kotlin. Fara scaderea celor 0.08 pragul efectiv
 * ar ajunge ~0.26 pe EAR brut in loc de 0.18, adica ochi normal deschisi
 * marcati drept clipiti — bug real, prins o data deja pe calea web.
 */
export const MESH_BLINK_THRESHOLD = (0.18 - 0.08) / 0.25;

export function readFaceEngine(): FaceEngine {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'landmarker' ? 'landmarker' : 'mlkit';
  } catch {
    return 'mlkit';
  }
}

export function writeFaceEngine(engine: FaceEngine): void {
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    // stocare indisponibila — setarea se aplica pentru sesiunea curenta
  }
}

/**
 * Biblioteca are poze scorate pe ALT motor decat cel activ acum?
 *
 * `undefined` pe inregistrarile de dinaintea campului: sunt, prin definitie, de
 * pe calea veche — singura care exista atunci.
 */
export function hasMixedFaceEngines(
  analyses: readonly { faceEngine?: FaceEngine }[],
  current: FaceEngine
): boolean {
  return analyses.some(a => (a.faceEngine ?? 'mlkit') !== current);
}
