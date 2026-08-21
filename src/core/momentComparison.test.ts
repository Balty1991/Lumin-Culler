import { describe, expect, it } from 'vitest';
import { compareWithinMoment, type MomentFrame } from './momentComparison';

const cadru = (id: string, o: Partial<MomentFrame> = {}): MomentFrame => ({
  id, sharpness: 70, faceCount: 1, allEyesOpen: true, ...o
});

describe('compararea unei poze cu surorile ei din serie', () => {
  it('nu spune nimic despre o poza fara serie', () => {
    const a = cadru('a');
    expect(compareWithinMoment(a, [a])).toBe(null);
  });

  it('nu inventeaza o diferenta intre cadre practic identice', () => {
    const a = cadru('a', { sharpness: 71 });
    const b = cadru('b', { sharpness: 73 });
    expect(compareWithinMoment(a, [a, b])).toBe(null);
  });

  it('spune cand e vizibil mai clara decat restul', () => {
    const a = cadru('a', { sharpness: 85 });
    const b = cadru('b', { sharpness: 60 });
    const c = cadru('c', { sharpness: 55 });
    expect(compareWithinMoment(a, [a, b, c])).toEqual({ key: 'sharpest', frames: 3 });
  });

  it('spune si invers — ca alt cadru din serie e mai clar', () => {
    const a = cadru('a', { sharpness: 55 });
    const b = cadru('b', { sharpness: 85 });
    expect(compareWithinMoment(a, [a, b])).toEqual({ key: 'softerThanSibling', frames: 2 });
  });

  it('ochii deschisi trec inaintea claritatii — e defectul care nu se repara', () => {
    // mai putin clara, dar singura in care nu clipeste nimeni
    const a = cadru('a', { sharpness: 50, allEyesOpen: true });
    const b = cadru('b', { sharpness: 90, allEyesOpen: false });
    expect(compareWithinMoment(a, [a, b])).toEqual({ key: 'onlyEyesOpen', frames: 2 });
  });

  it('"singura cu ochii deschisi" doar cand chiar e singura', () => {
    const a = cadru('a', { sharpness: 70, allEyesOpen: true });
    const b = cadru('b', { sharpness: 70, allEyesOpen: true });
    expect(compareWithinMoment(a, [a, b])).toBe(null);
  });

  it('pe poze fara oameni, ochii nu inseamna nimic', () => {
    const a = cadru('a', { faceCount: 0, sharpness: 70, allEyesOpen: true });
    const b = cadru('b', { faceCount: 0, sharpness: 70, allEyesOpen: false });
    expect(compareWithinMoment(a, [a, b])).toBe(null);
  });

  it('foloseste fractiunea de grup cand exista — o poza de grup nu e "toti sau nimeni"', () => {
    const a = cadru('a', { faceCount: 4, groupEyesOpenRatio: 1 });
    const b = cadru('b', { faceCount: 4, groupEyesOpenRatio: 0.75 });
    expect(compareWithinMoment(a, [a, b])).toEqual({ key: 'onlyEyesOpen', frames: 2 });
  });

  it('numara toate cadrele momentului, inclusiv poza insasi', () => {
    const a = cadru('a', { sharpness: 90 });
    const rest = ['b', 'c', 'd', 'e'].map(id => cadru(id, { sharpness: 60 }));
    expect(compareWithinMoment(a, [a, ...rest])?.frames).toBe(5);
  });
});
