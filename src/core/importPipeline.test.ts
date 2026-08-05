import { describe, expect, it } from 'vitest';
import { toHashInput, decidePhotoStatus, SELECT_THRESHOLD, REJECT_THRESHOLD } from './importPipeline';
import type { AnalysisRecord } from './db';

function baseAnalysis(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    photoId: 'p1',
    faces: [],
    faceCount: 0,
    knownFaceCount: 0,
    strangerCount: 0,
    bestSmile: 0.4,
    allEyesOpen: true,
    sharpness: 77,
    exposure: 52,
    sceneType: 'landscape',
    aiScore: 63,
    analyzedAt: Date.now(),
    ...overrides
  };
}

describe('toHashInput', () => {
  it('carries the id/hash and the fields groupSelection.pickBestInGroup needs, straight from the analysis', () => {
    const input = toHashInput('id-1', 'deadbeef', baseAnalysis({ compositionScore: 0.8, faceCount: 2, bestSmile: 0.9 }));
    expect(input).toEqual({
      id: 'id-1',
      hash: 'deadbeef',
      score: 63,
      sharpness: 77,
      exposure: 52,
      compositionScore: 0.8,
      faceCount: 2,
      bestSmile: 0.9,
      groupSmileRatio: undefined,
      allEyesOpen: true,
      groupEyesOpenRatio: undefined,
      avgEyeContact: undefined,
      faceEmbeddings: [],
      colorHarmonyScore: undefined
    });
  });

  it('extrage embedding-urile fetelor detectate (pentru rafinarea grupurilor in hashCompare.worker) si trece colorHarmonyScore', () => {
    const faceWithEmbedding = { box: [0, 0, 1, 1] as [number, number, number, number], faceScore: 0.9, smile: 0.5, eyesOpen: { left: 1, right: 1 }, isBlinking: false, personId: null, personName: null, similarity: 0, embedding: [1, 2, 3] };
    const faceWithoutEmbedding = { ...faceWithEmbedding, embedding: undefined };
    const input = toHashInput('id-2', 'abc', baseAnalysis({ faces: [faceWithEmbedding, faceWithoutEmbedding], colorHarmonyScore: 0.7 }));

    expect(input.faceEmbeddings).toEqual([[1, 2, 3]]);
    expect(input.colorHarmonyScore).toBe(0.7);
  });
});

describe('decidePhotoStatus', () => {
  it('respinge sub REJECT_THRESHOLD indiferent de subiect', () => {
    expect(decidePhotoStatus(REJECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: ['cat'] }))).toBe('rejected');
  });

  it('aproba peste SELECT_THRESHOLD cand exista o fata detectata', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [] }))).toBe('selected');
  });

  it('aproba peste SELECT_THRESHOLD cand exista cel putin o eticheta de scena/obiect, chiar fara fete', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 0, sceneTags: ['cat'] }))).toBe('selected');
  });

  it('NU aproba automat peste SELECT_THRESHOLD cand nu exista nicio fata SI nicio eticheta de scena (document/textura fara subiect) — ramane review', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 0, sceneTags: [] }))).toBe('review');
    expect(decidePhotoStatus(99, baseAnalysis({ faceCount: 0, sceneTags: undefined }))).toBe('review');
  });

  it('ramane review intre praguri, ca inainte', () => {
    expect(decidePhotoStatus((SELECT_THRESHOLD + REJECT_THRESHOLD) / 2, baseAnalysis({ faceCount: 1 }))).toBe('review');
  });

  it('NU aproba automat cand textCoverage e dominant (document/captura de ecran), chiar daca exista fete/etichete din intamplare', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: ['book'], textCoverage: 0.3 }))).toBe('review');
  });

  it('aproba normal cand textCoverage e absent sau sub prag (web/PWA nu are OCR — mereu absent acolo)', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [], textCoverage: undefined }))).toBe('selected');
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [], textCoverage: 0.05 }))).toBe('selected');
  });
});
