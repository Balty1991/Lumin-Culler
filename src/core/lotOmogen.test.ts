import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ContextEngine } from './learning/ContextEngine';
import { decidePhotoStatus } from './importPipeline';
import { deriveThresholds } from './scoreThresholds';
import type { AnalysisRecord } from './db';

/**
 * Cazul raportat de utilizator, cu capturi de pe telefon: un lot de poze ale
 * aceluiasi copil, in aceeasi dupa-amiaza, toate clare si bine expuse — si 13
 * respinse din 19, cu scoruri de 0, 1, 4 si 6.
 *
 * Testul reproduce exact asta: un lot OMOGEN, in care nicio poza nu are vreun
 * defect. Nu verifica scoruri anume (ar fi un test despre implementare), ci
 * consecinta care conteaza: pe un lot fara defecte, respingerea automata nu
 * are ce sa arunce.
 */
function pozaBuna(i: number): AnalysisRecord {
  // variatii mici, cat exista intre doua cadre consecutive ale aceleiasi scene
  // seed diferit per feature: intre doua cadre ale aceleiasi scene, claritatea
  // si zambetul nu variaza in acelasi pas, iar un jitter perfect corelat ar
  // exagera imprastierea fata de realitate
  let seed = 0;
  const jitter = (n: number, amp: number) => {
    seed += 1;
    return n + (((i + 1) * (17 + seed * 13)) % 11 - 5) / 5 * amp;
  };
  return {
    photoId: `p${i}`,
    faces: [{
      box: [0.3, 0.25, 0.25, 0.35], faceScore: jitter(0.92, 0.03),
      smile: jitter(0.7, 0.1), eyesOpen: { left: 1, right: 1 },
      isBlinking: false, personId: null, personName: null, similarity: 0
    }],
    faceCount: 1,
    knownFaceCount: 0,
    strangerCount: 1,
    bestSmile: jitter(0.7, 0.1),
    allEyesOpen: true,
    sharpness: jitter(76, 4),
    exposure: jitter(51, 3),
    sceneType: 'portrait',
    aiScore: 0,
    analyzedAt: Date.now(),
    ruleOfThirds: jitter(0.6, 0.08),
    headroom: jitter(0.6, 0.08),
    groupEyesOpenRatio: 1,
    groupSmileRatio: jitter(0.7, 0.1),
    highlightClipping: 0.01,
    shadowClipping: 0.01,
    subjectInFocus: true,
    sceneTags: ['child', 'outdoor']
  } as AnalysisRecord;
}

describe('un lot omogen de poze bune', () => {
  it('nu produce nicio respingere automata', async () => {
    const engine = new ContextEngine();
    const lot = Array.from({ length: 19 }, (_, i) => pozaBuna(i));

    const scoruri: number[] = [];
    for (const a of lot) scoruri.push((await engine.predict(a)).score);

    const praguri = deriveThresholds([...scoruri].sort((x, y) => x - y));
    const statusuri = lot.map((a, i) => decidePhotoStatus(scoruri[i], a, praguri));
    const respinse = statusuri.filter(s => s === 'rejected').length;

    expect(respinse).toBe(0);
  });

  it('dar o poza chiar miscata din acelasi lot se respinge — plasa nu e o amnistie', async () => {
    const engine = new ContextEngine();
    const miscata = { ...pozaBuna(3), sharpness: 18 };
    const scor = (await engine.predict(miscata)).score;
    // fortam un scor mic: aici verificam DOAR ca defectul deschide poarta
    expect(decidePhotoStatus(Math.min(scor, 10), miscata)).toBe('rejected');
  });

  it('scorurile unui lot omogen nu se mai imprastie pe tot intervalul', async () => {
    // Simptomul vizibil din capturi: poze practic identice primeau 0 si 72.
    const engine = new ContextEngine();
    const lot = Array.from({ length: 19 }, (_, i) => pozaBuna(i));
    const scoruri: number[] = [];
    for (const a of lot) scoruri.push((await engine.predict(a)).score);
    const min = Math.min(...scoruri), max = Math.max(...scoruri);
    expect(max - min).toBeLessThan(25);
  });
});

describe('dupa ce motorul a invatat din decizii reale', () => {
  /**
   * Testul de mai sus foloseste un motor VIRGIN, unde statisticile per feature
   * sunt goale si normalizarea intoarce valorile brute — deci nu atinge deloc
   * cauza de fond. Aici motorul e antrenat intai pe cateva decizii, ca
   * statisticile sa se incalzeasca (n > 2), si abia atunci se masoara
   * imprastierea: exact situatia utilizatorului, care triase deja zeci de poze
   * inainte sa vada scorurile de 0 si 1.
   */
  async function motorAntrenat() {
    const engine = new ContextEngine();
    for (let i = 0; i < 12; i++) {
      const a = pozaBuna(i);
      await engine.recordCorrection({
        photoId: a.photoId,
        analysis: a,
        aiDecision: i % 2 === 0,
        userDecision: i % 3 !== 0
      });
    }
    return engine;
  }

  it('un lot omogen ramane grupat, nu se desface in evantai de la 0 la 100', async () => {
    const engine = await motorAntrenat();
    const lot = Array.from({ length: 19 }, (_, i) => pozaBuna(i + 100));
    const scoruri: number[] = [];
    for (const a of lot) scoruri.push((await engine.predict(a)).score);
    const min = Math.min(...scoruri), max = Math.max(...scoruri);
    // 40 e larg cu buna stiinta: testul apara ordinul de marime, nu o valoare
    // exacta care s-ar schimba la orice reglaj de ponderi. Ce apara de fapt: un
    // lot de cadre ale aceleiasi scene nu are voie sa acopere jumatate din
    // scala de scor, pentru ca atunci pragul de respingere taie prin el.
    expect(max - min).toBeLessThan(40);
  });

  it('si tot nu respinge nimic dintr-un lot fara defecte', async () => {
    const engine = await motorAntrenat();
    const lot = Array.from({ length: 19 }, (_, i) => pozaBuna(i + 200));
    const scoruri: number[] = [];
    for (const a of lot) scoruri.push((await engine.predict(a)).score);
    const praguri = deriveThresholds([...scoruri].sort((x, y) => x - y));
    const respinse = lot.filter((a, i) => decidePhotoStatus(scoruri[i], a, praguri) === 'rejected').length;
    expect(respinse).toBe(0);
  });
});
