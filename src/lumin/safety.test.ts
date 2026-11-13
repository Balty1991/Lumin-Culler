import { describe, expect, it } from 'vitest';
import { safetyFrom, type TwinEntry } from './twin';

const e = (aiKeep: boolean, userKeep: boolean, people = false, firm = true): TwinEntry => ({ t: 0, same: aiKeep === userKeep, aiKeep, userKeep, people, firm });

describe('safetyFrom', () => {
  it('nu judecă sub 15 respingeri ferme', () => {
    expect(safetyFrom(Array.from({ length: 10 }, () => e(false, false))).rejectPrecision).toBeNull();
  });
  it('ignoră înclinațiile (nu ferme) și intrările vechi', () => {
    const log = [...Array.from({ length: 20 }, () => e(false, true, false, false)), { t: 0, same: false }];
    expect(safetyFrom(log).rejects).toBe(0);
  });
  it('sigur cu precizie mare și fără oameni salvați', () => {
    const log = [...Array.from({ length: 18 }, () => e(false, false)), e(false, true), e(true, true)];
    const s = safetyFrom(log);
    expect(s.rejectPrecision).toBeCloseTo(18 / 19);
    expect(s.safe).toBe(true);
  });
  it('nesigur când omul salvează poze cu oameni', () => {
    const log = [...Array.from({ length: 16 }, () => e(false, false, true)), ...Array.from({ length: 2 }, () => e(false, true, true))];
    const s = safetyFrom(log);
    expect(s.peopleRescued).toBe(2);
    expect(s.safe).toBe(false);
  });
});
