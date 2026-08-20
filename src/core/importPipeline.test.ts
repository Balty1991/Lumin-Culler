import { describe, expect, it } from 'vitest';
import { toHashInput, decidePhotoStatus, SELECT_THRESHOLD, REJECT_THRESHOLD } from './importPipeline';
import { deriveThresholds } from './scoreThresholds';
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
  it('respinge sub REJECT_THRESHOLD — o fata oarecare nu opreste respingerea', () => {
    // `knownFaceCount: 0` in baseAnalysis: un trecator nu e un motiv sa nu
    // respingem. Altfel respingerea automata ar disparea pe orice galerie cu
    // oameni, adica exact functia pentru care exista aplicatia.
    expect(decidePhotoStatus(REJECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: ['cat'] }))).toBe('rejected');
  });

  it('NU respinge automat o poza in care apare cineva inrolat — o trimite la verificat', () => {
    // Cazul concret: singura poza dintr-o zi cu copilul, iesita putin miscata.
    // Scorul e mic pentru ca mestesugul e slab, dar poza conteaza.
    expect(decidePhotoStatus(REJECT_THRESHOLD - 20, baseAnalysis({ faceCount: 1, knownFaceCount: 1 })))
      .toBe('review');
  });

  it('garantia se aplica si la scor zero — nu e o marja, e o regula', () => {
    expect(decidePhotoStatus(0, baseAnalysis({ faceCount: 2, knownFaceCount: 1 }))).toBe('review');
  });

  it('nu forteaza pastrarea: o poza cu persoana inrolata sub prag NU devine selectata', () => {
    // plasa opreste aruncarea, nu umfla scorul
    expect(decidePhotoStatus(REJECT_THRESHOLD - 20, baseAnalysis({ faceCount: 1, knownFaceCount: 1 })))
      .not.toBe('selected');
  });

  it('peste pragul de selectie, persoana inrolata nu schimba nimic', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, knownFaceCount: 1 })))
      .toBe('selected');
  });

  it('garantia tine si cu praguri adaptate, nu doar cu cele fixe', () => {
    const adapted = { select: 70, reject: 40, adapted: true };
    expect(decidePhotoStatus(35, baseAnalysis({ faceCount: 1, knownFaceCount: 1 }), adapted)).toBe('review');
    expect(decidePhotoStatus(35, baseAnalysis({ faceCount: 1, knownFaceCount: 0 }), adapted)).toBe('rejected');
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

  it('NU aproba automat cand singurele etichete sunt abstracte/non-subiect (ex. "Photography", "Text" — vocabular ML Kit nativ), chiar fara fete — ramane review', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 0, sceneTags: ['Photography', 'Text'] }))).toBe('review');
  });

  it('aproba peste SELECT_THRESHOLD cand exista o eticheta concreta amestecata cu una abstracta', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 0, sceneTags: ['Photography', 'cat'] }))).toBe('selected');
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

  it('NU aproba automat cand subjectInFocus e confirmat fals (bug real: obiect ascutit in prim-plan umfla claritatea globala, dar subiectul real e neclar) — ramane review', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [], subjectInFocus: false }))).toBe('review');
    expect(decidePhotoStatus(99, baseAnalysis({ faceCount: 1, sceneTags: ['cat'], subjectInFocus: false }))).toBe('review');
  });

  it('aproba normal cand subjectInFocus e true sau nemasurabil (absent nu e penalizat)', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [], subjectInFocus: true }))).toBe('selected');
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1, sceneTags: [], subjectInFocus: undefined }))).toBe('selected');
  });
});

// Plasa de siguranta pentru pragurile fixe (vezi core/scoreThresholds.ts):
// decidePhotoStatus le primeste ca parametru, dar TOATE celelalte reguli
// (document/captura de ecran, subiect confirmat neclar) raman neschimbate.
describe('decidePhotoStatus cu praguri adaptate', () => {
  // Sesiune in interior: scorurile stau intre 30 si 66, deci pragul fix de 65
  // ar propune sub 3% din poze. Coboara la ~59 — dar NU sub 55: nu auto-selectam
  // niciodata o poza pe care motorul o crede la limita "poate da, poate nu".
  const intuneric = Array.from({ length: 400 }, (_, i) => 30 + Math.round((i / 399) * 36));
  const adaptate = deriveThresholds(intuneric);
  const BUNA_PENTRU_LOTUL_ASTA = 61;

  it('propune pozele bune ale lotului, pe care pragul fix le-ar fi trimis toate la revizuire', () => {
    expect(decidePhotoStatus(BUNA_PENTRU_LOTUL_ASTA, baseAnalysis({ faceCount: 1 }))).toBe('review');
    expect(decidePhotoStatus(BUNA_PENTRU_LOTUL_ASTA, baseAnalysis({ faceCount: 1 }), adaptate)).toBe('selected');
  });

  it('nu coboara pragul sub podeaua absoluta, oricat de slab ar fi lotul', () => {
    const totSlab = Array.from({ length: 400 }, (_, i) => 20 + Math.round((i / 399) * 30)); // 20..50
    const t = deriveThresholds(totSlab);
    expect(t.select).toBe(55);
    // cea mai buna poza din lot (50) tot nu se auto-selecteaza — ramane la revizuire
    expect(decidePhotoStatus(50, baseAnalysis({ faceCount: 1 }), t)).toBe('review');
  });

  it('se comporta exact ca inainte cand nu i se dau praguri', () => {
    expect(decidePhotoStatus(SELECT_THRESHOLD, baseAnalysis({ faceCount: 1 }))).toBe('selected');
    expect(decidePhotoStatus(REJECT_THRESHOLD, baseAnalysis({ faceCount: 1 }))).toBe('rejected');
  });

  it('nu slabeste protectia pentru documente/capturi de ecran, oricat de jos ar cobori pragul', () => {
    expect(decidePhotoStatus(BUNA_PENTRU_LOTUL_ASTA, baseAnalysis({ faceCount: 0, sceneTags: [] }), adaptate)).toBe('review');
    expect(decidePhotoStatus(BUNA_PENTRU_LOTUL_ASTA, baseAnalysis({ faceCount: 1, textCoverage: 0.9 }), adaptate)).toBe('review');
  });

  it('nu slabeste nici blocarea unui subiect confirmat neclar', () => {
    expect(decidePhotoStatus(BUNA_PENTRU_LOTUL_ASTA, baseAnalysis({ faceCount: 1, subjectInFocus: false }), adaptate)).toBe('review');
  });
});
