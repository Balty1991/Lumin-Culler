import { describe, it, expect } from 'vitest';
import { explainGroupChoice, type GroupMember, SHARPNESS_GAP, SCORE_TIE } from './groupVerdict';

function m(id: string, over: Partial<GroupMember> = {}): GroupMember {
  return {
    id, aiScore: 60, sharpness: 60, exposure: 50, faceCount: 1,
    allEyesOpen: true, bestSmile: 0.5, ...over
  };
}

describe('explainGroupChoice', () => {
  it('nu explica nimic pentru un grup de un singur cadru', () => {
    expect(explainGroupChoice([m('a')], 'a')).toBeNull();
  });

  it('nu explica nimic daca cadrul pastrat nu e in grup', () => {
    expect(explainGroupChoice([m('a'), m('b')], 'c')).toBeNull();
  });

  it('ochii inchisi la ceilalti sunt primul motiv, inaintea claritatii', () => {
    const v = explainGroupChoice([
      m('a', { allEyesOpen: true, sharpness: 50 }),
      m('b', { allEyesOpen: false, sharpness: 90 })
    ], 'a')!;
    expect(v.reasons[0].key).toBe('groupVerdict.reason.eyesOnlyOneOfTwo');
    expect(v.confidence).toBe('high');
  });

  it('pentru grupuri mai mari foloseste formularea de "singura"', () => {
    const v = explainGroupChoice([
      m('a', { allEyesOpen: true }), m('b', { allEyesOpen: false }), m('c', { allEyesOpen: false })
    ], 'a')!;
    expect(v.reasons[0].key).toBe('groupVerdict.reason.eyesOnlyOne');
  });

  it('la poze de grup compara procentul de ochi deschisi, nu tot-sau-nimic', () => {
    const v = explainGroupChoice([
      m('a', { faceCount: 4, allEyesOpen: false, groupEyesOpenRatio: 0.75 }),
      m('b', { faceCount: 4, allEyesOpen: false, groupEyesOpenRatio: 0.25 })
    ], 'a')!;
    expect(v.reasons[0]).toEqual({ key: 'groupVerdict.reason.eyesMore', params: { kept: 75, other: 25 } });
  });

  it('o diferenta mica de ochi la grup nu se raporteaza', () => {
    const v = explainGroupChoice([
      m('a', { faceCount: 4, allEyesOpen: false, groupEyesOpenRatio: 0.8 }),
      m('b', { faceCount: 4, allEyesOpen: false, groupEyesOpenRatio: 0.7 })
    ], 'a')!;
    expect(v.reasons.some(r => r.key.startsWith('groupVerdict.reason.eyes'))).toBe(false);
  });

  it('claritatea se raporteaza cu diferenta reala, peste prag', () => {
    const v = explainGroupChoice([
      m('a', { sharpness: 80 }), m('b', { sharpness: 80 - SHARPNESS_GAP })
    ], 'a')!;
    expect(v.reasons[0]).toEqual({ key: 'groupVerdict.reason.sharper', params: { gap: SHARPNESS_GAP } });
  });

  it('o diferenta de claritate sub prag nu se raporteaza', () => {
    const v = explainGroupChoice([m('a', { sharpness: 80 }), m('b', { sharpness: 75 })], 'a')!;
    expect(v.reasons.some(r => r.key === 'groupVerdict.reason.sharper')).toBe(false);
  });

  it('zambetul conteaza doar la o diferenta vizibila', () => {
    const v = explainGroupChoice([m('a', { bestSmile: 0.9 }), m('b', { bestSmile: 0.2 })], 'a')!;
    expect(v.reasons).toContainEqual({ key: 'groupVerdict.reason.smile', params: { kept: 90 } });
  });

  it('expunerea se mentioneaza doar cand celelalte chiar sunt gresit expuse', () => {
    const ok = explainGroupChoice([m('a', { exposure: 50 }), m('b', { exposure: 20 })], 'a')!;
    expect(ok.reasons).toContainEqual({ key: 'groupVerdict.reason.exposure' });
    // ambele aproape de mijloc: nu e un motiv
    const nu = explainGroupChoice([m('a', { exposure: 50 }), m('b', { exposure: 56 })], 'a')!;
    expect(nu.reasons.some(r => r.key === 'groupVerdict.reason.exposure')).toBe(false);
  });

  it('fara fete nu inventeaza motive despre ochi sau zambet', () => {
    const v = explainGroupChoice([
      m('a', { faceCount: 0, allEyesOpen: false, bestSmile: 0, sharpness: 90 }),
      m('b', { faceCount: 0, allEyesOpen: true, bestSmile: 1, sharpness: 50 })
    ], 'a')!;
    expect(v.reasons.map(r => r.key)).toEqual(['groupVerdict.reason.sharper']);
  });

  it('cade pe scorul AI cand nimic observabil nu le desparte, dar scorul da', () => {
    const v = explainGroupChoice([m('a', { aiScore: 80 }), m('b', { aiScore: 80 - SCORE_TIE })], 'a')!;
    expect(v.reasons).toEqual([{ key: 'groupVerdict.reason.score', params: { gap: SCORE_TIE } }]);
    expect(v.confidence).toBe('high');
  });

  it('spune pe fata cand cadrele sunt practic identice', () => {
    const v = explainGroupChoice([m('a', { aiScore: 80 }), m('b', { aiScore: 79 })], 'a')!;
    expect(v.confidence).toBe('low');
    expect(v.reasons).toEqual([{ key: 'groupVerdict.reason.tooClose', params: { gap: 1 } }]);
  });

  it('nu raporteaza niciodata o diferenta negativa de scor', () => {
    // cadrul pastrat poate avea scor mai MIC (utilizatorul a ales altfel)
    const v = explainGroupChoice([m('a', { aiScore: 70 }), m('b', { aiScore: 80 })], 'a')!;
    expect(v.confidence).toBe('low');
    expect(v.reasons[0].params!.gap).toBe(0);
  });

  it('aduna mai multe motive, in ordinea in care conteaza pentru un om', () => {
    const v = explainGroupChoice([
      m('a', { allEyesOpen: true, sharpness: 90, bestSmile: 0.9, exposure: 50 }),
      m('b', { allEyesOpen: false, sharpness: 60, bestSmile: 0.2, exposure: 20 })
    ], 'a')!;
    expect(v.reasons.map(r => r.key)).toEqual([
      'groupVerdict.reason.eyesOnlyOneOfTwo',
      'groupVerdict.reason.sharper',
      'groupVerdict.reason.smile',
      'groupVerdict.reason.exposure'
    ]);
  });
});
