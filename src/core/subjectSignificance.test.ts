import { describe, it, expect } from 'vitest';
import {
  subjectRank, compareBySignificance,
  RANK_KNOWN_PERSON, RANK_PEOPLE, RANK_OTHER, RANK_DOCUMENT
} from './subjectSignificance';

describe('subjectRank', () => {
  it('pune in ordine cele patru categorii', () => {
    expect(subjectRank({ knownFaceCount: 1, faceCount: 1 })).toBe(RANK_KNOWN_PERSON);
    expect(subjectRank({ faceCount: 2 })).toBe(RANK_PEOPLE);
    expect(subjectRank({ faceCount: 0 })).toBe(RANK_OTHER);
    expect(subjectRank({ textCoverage: 0.9 })).toBe(RANK_DOCUMENT);
  });

  it('documentul se verifica INAINTEA fetelor', () => {
    // o captura a unei conversatii poate contine fete; un act de identitate
    // contine chiar o fata inrolata. Ordinea inversa le-ar promova.
    expect(subjectRank({ textCoverage: 0.9, faceCount: 3 })).toBe(RANK_DOCUMENT);
    expect(subjectRank({ textCoverage: 0.9, knownFaceCount: 1 })).toBe(RANK_DOCUMENT);
  });

  it('textul necunoscut nu inseamna zero — pe web nu exista OCR', () => {
    expect(subjectRank({ faceCount: 1 })).toBe(RANK_PEOPLE);
    expect(subjectRank({})).toBe(RANK_OTHER);
  });

  it('putin text nu face din poza un document', () => {
    // o firma pe o cladire, un tricou cu scris
    expect(subjectRank({ textCoverage: 0.02, faceCount: 1 })).toBe(RANK_PEOPLE);
  });
});

describe('compareBySignificance', () => {
  const p = (over: Record<string, unknown>) => ({ aiScore: 50, ...over }) as never;

  it('cazul raportat: hartia clara cade sub poza mai slaba cu copilul', () => {
    const hartie = p({ aiScore: 99, textCoverage: 0.8 });
    const copilul = p({ aiScore: 62, knownFaceCount: 1, faceCount: 1 });
    expect([hartie, copilul].sort(compareBySignificance)[0]).toBe(copilul);
  });

  it('peisajul clar cade sub poza cu oameni', () => {
    const peisaj = p({ aiScore: 96, faceCount: 0 });
    const oameni = p({ aiScore: 71, faceCount: 2 });
    expect([peisaj, oameni].sort(compareBySignificance)[0]).toBe(oameni);
  });

  it('o persoana inrolata trece inaintea unui necunoscut', () => {
    const strain = p({ aiScore: 90, faceCount: 1 });
    const alTau = p({ aiScore: 80, faceCount: 1, knownFaceCount: 1 });
    expect([strain, alTau].sort(compareBySignificance)[0]).toBe(alTau);
  });

  it('in aceeasi categorie decide scorul, exact ca inainte', () => {
    const slab = p({ aiScore: 40, faceCount: 1 });
    const bun = p({ aiScore: 90, faceCount: 1 });
    expect([slab, bun].sort(compareBySignificance)).toEqual([bun, slab]);
  });

  it('nu schimba nimic pe o biblioteca fara fete si fara text', () => {
    const items = [p({ aiScore: 10 }), p({ aiScore: 90 }), p({ aiScore: 50 })];
    expect([...items].sort(compareBySignificance).map(x => (x as { aiScore: number }).aiScore))
      .toEqual([90, 50, 10]);
  });
});
