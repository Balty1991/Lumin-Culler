/**
 * Aceeași poză, două reguli.
 *
 * decidePhotoStatus e regula din 2.1.2 pentru o analiză completă (fețe,
 * etichete, clipping măsurate). decideIsolate e regula pentru o poză singură
 * care n-a trecut prin modele: nu are voie să pice testul de subiect și nu
 * are voie să inventeze clipping.
 */
import { describe, expect, it } from 'vitest';
import { decidePhotoStatus, DEFECT_EYES_OPEN_RATIO, DEFECT_SHARPNESS, SELECT_THRESHOLD, REJECT_THRESHOLD } from './importPipeline';
import { decideIsolate, ISOLATE_DEFECT_SHARPNESS, ISOLATE_EYES_OPEN_MIN } from './singletonVerdict';
import type { AnalysisRecord } from './db';

function full(over: Partial<AnalysisRecord>): Pick<AnalysisRecord,
  'faceCount' | 'knownFaceCount' | 'sceneTags' | 'textCoverage' | 'subjectInFocus'
  | 'sharpness' | 'exposure' | 'highlightClipping' | 'shadowClipping' | 'allEyesOpen' | 'groupEyesOpenRatio'> {
  return {
    faceCount: 1,
    knownFaceCount: 0,
    sceneTags: ['person'],
    sharpness: 80,
    exposure: 50,
    allEyesOpen: true,
    highlightClipping: 0,
    shadowClipping: 0,
    ...over
  };
}

describe('paritate cu 2.1.2 pe analiza completă', () => {
  it('pragurile pozei singure sunt aceleași numere ca defectele din 2.1.2', () => {
    expect(ISOLATE_DEFECT_SHARPNESS).toBe(DEFECT_SHARPNESS);
    expect(ISOLATE_EYES_OPEN_MIN).toBe(DEFECT_EYES_OPEN_RATIO);
  });

  it('un portret clar peste prag rămâne păstrat, ca în 2.1.2', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, full({}))).toBe('selected');
  });

  it('ochii închiși și scorul mic rămân respinși, ca în 2.1.2', () => {
    expect(decidePhotoStatus(REJECT_THRESHOLD, full({ allEyesOpen: false, sharpness: 80 }))).toBe('rejected');
  });

  it('fără defect numit, scorul mic rămâne de verificat, ca în 2.1.2', () => {
    expect(decidePhotoStatus(REJECT_THRESHOLD, full({ sharpness: 80, exposure: 50 }))).toBe('review');
  });

  it('fără subiect măsurat, 2.1.2 nu păstrează automat', () => {
    expect(decidePhotoStatus(99, full({ faceCount: 0, sceneTags: [] }))).toBe('review');
  });
});

describe('poza singură, nemăsurată de modele', () => {
  it('aceeași claritate, fără etichete, se păstrează — nu mai cade pe „fără subiect”', () => {
    const light = { fileName: 'IMG_100.jpg', sharpness: 80, exposure: 50, paperScore: 0.05 };
    expect(decideIsolate(light).status).toBe('selected');
    expect(decidePhotoStatus(99, full({ faceCount: 0, sceneTags: [], sharpness: 80, exposure: 50 }))).toBe('review');
  });

  it('neclaritatea se respinge fără să inventeze clipping', () => {
    expect(decideIsolate({ fileName: 'IMG_101.jpg', sharpness: 6, exposure: 50 }).status).toBe('rejected');
  });

  it('bonul nu intră în coada generală', () => {
    expect(decideIsolate({ fileName: 'receipt.jpg', sharpness: 90, exposure: 60, paperScore: 0.8 }).aside).toBe('document');
  });
});
