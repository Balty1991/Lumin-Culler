/**
 * core/sceneClassifier.ts
 * `classifyScene` extras din faceAnalysis.worker.ts intr-un modul separat,
 * fara dependinte grele (@vladmandic/human) — reutilizat si de
 * core/nativeAnalysis.ts (pipeline-ul nativ Android). Daca ar ramane definit
 * doar in worker, un import direct de acolo ar putea trage in bundle-ul
 * principal intreg graful Human.js/TFJS, chiar daca `classifyScene` insusi
 * nu il foloseste — risc real de bundle-bloat pe exact platforma (native)
 * unde tinta e sa NU mai incarcam deloc Human.js.
 */
import type { AnalysisRecord, FaceInsight } from './db';

export function classifyScene(faces: FaceInsight[], w: number, h: number): AnalysisRecord['sceneType'] {
  if (faces.length === 0) return w >= h ? 'landscape' : 'detail';
  // O singura fata e mereu "portret", indiferent de cat de mica/departe e in cadru
  // (bug real gasit de auditul QA: un portret de mediu/environmental cu subiectul mic
  // in cadru era clasificat gresit ca "group", diluand modelul de invatare per context).
  if (faces.length === 1) return 'portrait';
  if (faces.length >= 3) return 'group';
  const largest = Math.max(...faces.map(f => f.box[2] * f.box[3]));
  return largest > 0.04 ? 'portrait' : 'group';
}
