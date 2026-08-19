import { describe, it, expect } from 'vitest';
import { selectDecisionInversions, countDecisionInversions, MIN_SCORE_GAP, type InversionCandidate } from './decisionInversions';

const p = (id: string, groupId: string | undefined, status: InversionCandidate['status'], aiScore: number): InversionCandidate =>
  ({ id, groupId, status, aiScore });

describe('selectDecisionInversions', () => {
  it('gaseste o poza respinsa mult mai buna decat cea pastrata din aceeasi serie', () => {
    const photos = [p('buna', 'g1', 'rejected', 90), p('slaba', 'g1', 'selected', 60)];
    expect(selectDecisionInversions(photos)).toEqual(['buna']);
  });

  it('tace cand diferenta e sub prag — intre doua cadre dintr-o rafala e zgomot', () => {
    const photos = [p('a', 'g1', 'rejected', 72), p('b', 'g1', 'selected', 60)];
    expect(selectDecisionInversions(photos)).toEqual([]);
    // exact la prag se raporteaza
    expect(selectDecisionInversions([p('a', 'g1', 'rejected', 60 + MIN_SCORE_GAP), p('b', 'g1', 'selected', 60)])).toEqual(['a']);
  });

  it('ignora pozele fara serie: fara groupId nu exista cu ce compara', () => {
    expect(selectDecisionInversions([p('a', undefined, 'rejected', 95), p('b', undefined, 'selected', 20)])).toEqual([]);
  });

  it('nu compara intre serii diferite', () => {
    const photos = [p('a', 'g1', 'rejected', 95), p('b', 'g2', 'selected', 20)];
    expect(selectDecisionInversions(photos)).toEqual([]);
  });

  it('ignora grupurile fara nicio poza pastrata — nu exista contradictie', () => {
    const photos = [p('a', 'g1', 'rejected', 95), p('b', 'g1', 'rejected', 20), p('c', 'g1', 'pending', 99)];
    expect(selectDecisionInversions(photos)).toEqual([]);
  });

  it('se raporteaza la CEA MAI BUNA poza pastrata, nu la oricare', () => {
    // 88 depaseste pastrata slaba (50) cu 38, dar pe cea mai buna (80) doar cu 8 — sub prag
    const photos = [p('resp', 'g1', 'rejected', 88), p('slaba', 'g1', 'selected', 50), p('buna', 'g1', 'selected', 80)];
    expect(selectDecisionInversions(photos)).toEqual([]);
  });

  it('intoarce doar respinsele: ele sunt cele care s-ar pierde la stergere', () => {
    const photos = [p('resp', 'g1', 'rejected', 90), p('pastrata', 'g1', 'selected', 60)];
    expect(selectDecisionInversions(photos)).not.toContain('pastrata');
  });

  it('sorteaza descrescator dupa diferenta, ca sa apara intai cazurile clare', () => {
    const photos = [
      p('mica', 'g1', 'rejected', 78), p('k1', 'g1', 'selected', 60),
      p('mare', 'g2', 'rejected', 99), p('k2', 'g2', 'selected', 30),
    ];
    expect(selectDecisionInversions(photos)).toEqual(['mare', 'mica']);
  });

  it('respecta plafonul de lot', () => {
    const photos: InversionCandidate[] = [];
    for (let i = 0; i < 40; i++) { photos.push(p(`r${i}`, `g${i}`, 'rejected', 90), p(`k${i}`, `g${i}`, 'selected', 40)); }
    expect(selectDecisionInversions(photos, MIN_SCORE_GAP, 5)).toHaveLength(5);
    expect(selectDecisionInversions(photos, MIN_SCORE_GAP, 0)).toEqual([]);
  });

  it('countDecisionInversions numara tot, fara plafon', () => {
    const photos: InversionCandidate[] = [];
    for (let i = 0; i < 40; i++) { photos.push(p(`r${i}`, `g${i}`, 'rejected', 90), p(`k${i}`, `g${i}`, 'selected', 40)); }
    expect(countDecisionInversions(photos)).toBe(40);
  });

  it('o biblioteca goala nu produce nimic', () => {
    expect(selectDecisionInversions([])).toEqual([]);
    expect(countDecisionInversions([])).toBe(0);
  });
});
