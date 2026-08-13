/**
 * core/faceExpression.ts
 * `isAwkwardExpression` extrasa din faceAnalysis.worker.ts intr-un modul fara
 * dependinte de runtime — acelasi motiv ca la sceneClassifier.ts si
 * subjectProminence.ts: are nevoie de ea si UI-ul (core/frameComposite.ts, prin
 * GroupCompare), iar un import direct din worker ar trage intreg graful
 * Human.js/TFJS in bundle-ul principal, desi functia asta e cateva comparatii
 * pe campuri deja calculate.
 *
 * Importul de tip din db.ts se sterge la compilare, deci nu aduce Dexie cu el.
 */
import type { FaceInsight } from './db';

/**
 * Gura vizibil deschisa FARA sa fie explicata de un zambet sau o surpriza reala
 * — tipic un moment prins "la mijlocul vorbirii" sau un cascat. Pragurile pe
 * happy/surprise sunt deliberat joase (0.3): vrem sa excludem orice urma reala
 * a acestor emotii, nu doar cazul lor dominant.
 */
export function isAwkwardExpression(face: FaceInsight): boolean {
  if (!face.mouthOpen) return false;
  const happy = face.emotion?.happy ?? 0;
  const surprise = face.emotion?.surprise ?? 0;
  return happy < 0.3 && surprise < 0.3;
}
