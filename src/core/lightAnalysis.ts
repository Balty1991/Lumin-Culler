/**
 * core/lightAnalysis.ts
 * Analiza unei poze care NU e într-o serie.
 *
 * Modelele grele răspund la „care cadru din rafală e mai bun”. O poză fără
 * vecini nu are această întrebare. Rămân claritatea și expunerea măsurate pe
 * miniatura din etapa 1, suficiente pentru scorul de context, fără fețe inventate.
 */
import type { AnalysisRecord } from './db';

export function lightAnalysis(
  photoId: string,
  metrics: { sharpness: number; exposure: number },
  at: number = Date.now()
): AnalysisRecord {
  return {
    photoId,
    faces: [],
    faceCount: 0,
    knownFaceCount: 0,
    strangerCount: 0,
    bestSmile: 0,
    allEyesOpen: true,
    sharpness: metrics.sharpness,
    exposure: metrics.exposure,
    sceneType: 'landscape',
    aiScore: 0,
    analyzedAt: at,
    sceneTags: []
    // highlightClipping, shadowClipping, horizonTiltDeg, ruleOfThirds și
    // faceCount NU se inventează aici. Coada de salvare (rescueQueue) le citește
    // ca pe măsurători. O poză fără serie nu le are: nu intră la „se poate
    // salva”. Seriile trec prin analiza completă și le păstrează pe toate.
  };
}
