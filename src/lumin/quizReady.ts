/**
 * lumin/quizReady.ts
 * Are antrenamentul din ce face perechi acum? Aceeași judecată ca în TasteQuiz:
 * capturile, documentele și obiectele nu intră. Pauza de antrenament din citirea
 * galeriei întreabă aici înainte să oprească (raportat cu captură: pauza a apărut
 * după 40 de poze, dar butonul răspundea „îmi trebuie cel puțin 8 poze”).
 */
import type { PhotoView } from '../state/store';
import { classifyPhoto } from '../core/smartInbox';
import { buildTastePairs } from '../core/tastePairs';

export function quizReady(photos: readonly PhotoView[]): boolean {
  const all = photos.map(p => {
    const kind = classifyPhoto({ id: p.id, fileName: p.fileName, faceCount: p.faceCount, textCoverage: p.textCoverage, sceneTags: p.sceneTags });
    const notMemory = kind === 'document' || kind === 'screenshot' || kind === 'object';
    return { id: p.id, aiScore: p.aiScore, sharpness: p.sharpness, exposure: p.exposure, faceCount: p.faceCount, groupId: p.groupId, aside: p.aside ?? (notMemory ? 'document' as const : undefined) };
  });
  return buildTastePairs(all).length > 0;
}
