import { describe, expect, it } from 'vitest';
import { hasProminentFace, prominentFaces, subjectProminence, MIN_SUBJECT_FACE_AREA } from './subjectProminence';

/** O fata patrata cu aria data (fractiune din cadru), in coltul stanga-sus. */
function face(area: number, id = '') {
  const side = Math.sqrt(area);
  return { id, box: [0, 0, side, side] as [number, number, number, number] };
}

const PORTRET = 0.06;      // fata mare, subiectul clar al pozei
const TRECATOR = 0.0004;   // om mic intr-un peisaj

describe('prominentFaces', () => {
  it('pastreaza fetele destul de mari cat sa fie subiectul', () => {
    expect(prominentFaces([face(PORTRET, 'a')]).map(f => f.id)).toEqual(['a']);
  });

  it('scoate trecatorii minusculi dintr-un peisaj', () => {
    expect(prominentFaces([face(TRECATOR, 'a')])).toEqual([]);
  });

  it('pastreaza doar subiectii dintr-un cadru mixt, in ordinea originala', () => {
    const result = prominentFaces([face(TRECATOR, 'fundal-1'), face(PORTRET, 'subiect'), face(TRECATOR, 'fundal-2')]);
    expect(result.map(f => f.id)).toEqual(['subiect']);
  });

  it('e inclusiv exact la prag (o fata fix la limita conteaza ca subiect)', () => {
    // cutie construita direct, fara drumul prin sqrt din face(): altfel aria
    // reconstruita cade cu o ulp sub prag si testul ar masura virgula mobila,
    // nu regula
    expect(prominentFaces([{ box: [0, 0, MIN_SUBJECT_FACE_AREA, 1] as const }])).toHaveLength(1);
  });

  it('nu inventeaza subiecti dintr-o lista goala', () => {
    expect(prominentFaces([])).toEqual([]);
    expect(hasProminentFace([])).toBe(false);
  });
});

describe('subjectProminence', () => {
  it('creste cu dimensiunea subiectului in cadru', () => {
    expect(subjectProminence([face(TRECATOR)])!).toBeLessThan(subjectProminence([face(PORTRET)])!);
  });

  it('foloseste scala liniara, nu aria — o fata de jumatate de cadru da 1', () => {
    expect(subjectProminence([face(0.25)])).toBeCloseTo(1); // sqrt(0.25) = 0.5, adica 0.5/0.5
    expect(subjectProminence([face(0.16)])).toBeCloseTo(0.8);
  });

  it('nu depaseste 1 nici pentru o fata care umple cadrul', () => {
    expect(subjectProminence([face(1)])).toBe(1);
  });

  it('raporteaza cea mai mare fata, nu prima', () => {
    expect(subjectProminence([face(TRECATOR), face(0.16)])).toBeCloseTo(0.8);
  });

  it('nu spune nimic cand nu exista nicio cutie', () => {
    expect(subjectProminence([])).toBeNull();
  });
});
