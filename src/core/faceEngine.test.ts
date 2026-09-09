import { describe, expect, it, beforeEach } from 'vitest';
import { readFaceEngine, writeFaceEngine, hasMixedFaceEngines, MESH_BLINK_THRESHOLD } from './faceEngine';

/**
 * core/faceEngine.test.ts
 * Comutatorul dintre cele doua cai de detectie a fetelor, si singurul lucru din
 * el care poate face rau in tacere: o biblioteca amestecata, in care "cel mai
 * bun cadru" ar compara doua scari de scoruri fara sa dea nicio eroare.
 */
beforeEach(() => { localStorage.clear(); });

describe('care motor de fete', () => {
  it('implicit e calea de pana acum — nimic nu se schimba fara o alegere', () => {
    expect(readFaceEngine()).toBe('mlkit');
  });

  it('alegerea se tine minte', () => {
    writeFaceEngine('landmarker');
    expect(readFaceEngine()).toBe('landmarker');
    writeFaceEngine('mlkit');
    expect(readFaceEngine()).toBe('mlkit');
  });

  it('o valoare stricata in stocare cade tot pe calea veche, nu pe cea noua', () => {
    localStorage.setItem('lumin-face-engine', 'ceva-aiurea');
    expect(readFaceEngine()).toBe('mlkit');
  });

  /**
   * Pragul de clipit NU e ales aici: e BLINK_EAR_THRESHOLD (0.18) din
   * workers/faceAnalysis.worker.ts, trecut prin aceeasi normalizare ca
   * masuratoarea. Testul apara tocmai faptul ca sunt acelasi numar — daca cineva
   * il schimba intr-un loc si nu in celalalt, Androidul si webul ar incepe sa
   * numere clipitul diferit.
   */
  it('pragul de clipit e cel al build-ului web, nu unul nou', () => {
    expect(MESH_BLINK_THRESHOLD).toBeCloseTo((0.18 - 0.08) / 0.25, 10);
    expect(MESH_BLINK_THRESHOLD).toBeCloseTo(0.4, 10);
  });
});

describe('biblioteca amestecata', () => {
  it('inregistrarile fara camp sunt de pe calea veche — asta erau', () => {
    expect(hasMixedFaceEngines([{}, {}], 'mlkit')).toBe(false);
    expect(hasMixedFaceEngines([{}, {}], 'landmarker')).toBe(true);
  });

  it('o singura poza de pe cealalta cale e destul ca sa fie amestec', () => {
    const analyses = [
      { faceEngine: 'landmarker' as const },
      { faceEngine: 'landmarker' as const },
      { faceEngine: 'mlkit' as const }
    ];
    expect(hasMixedFaceEngines(analyses, 'landmarker')).toBe(true);
  });

  it('o biblioteca omogena nu deranjeaza pe nimeni', () => {
    const analyses = [{ faceEngine: 'landmarker' as const }, { faceEngine: 'landmarker' as const }];
    expect(hasMixedFaceEngines(analyses, 'landmarker')).toBe(false);
  });

  it('o biblioteca goala nu e amestecata', () => {
    expect(hasMixedFaceEngines([], 'landmarker')).toBe(false);
  });
});
