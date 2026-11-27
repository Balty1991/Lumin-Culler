import { describe, expect, it, vi } from 'vitest';
vi.mock('../core/learning/ContextEngine', () => ({ contextEngine: { keptSubjects: async () => [] } }));
import { personalWhy } from './why';
import { ro } from '../i18n/ro';

const tr = (k: string, v: Record<string, string | number> = {}) =>
  String((ro as Record<string, string>)[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v[n] ?? ''));
const base = { sharpness: 80, exposure: 50, faceCount: 1, allEyesOpen: true, bestSmile: 0.8, aiScore: 90, sceneTags: [] as string[] };

describe('personalWhy', () => {
  it('vorbește despre omul la care ții', () => {
    const s = personalWhy({ ...base, status: 'selected', personNames: ['Angi'] }, { loved: [{ name: 'Angi', rate: 0.9 }], subjects: [] }, tr);
    expect(s).toMatch(/^Ai păstrat-o: e Angi — păstrezi 9 din 10 poze cu Angi/);
  });
  it('spune de ce n-ai păstra-o', () => {
    const s = personalWhy({ ...base, sharpness: 20, allEyesOpen: false, bestSmile: 0, aiScore: 20, status: 'rejected', personNames: [] }, { loved: [], subjects: [] }, tr);
    expect(s).toContain('Ai pus-o la Nu păstrez');
    expect(s).toContain('mișcată');
  });
  it('din serie: spune că e una mai clară, când chiar e', () => {
    const ctx = { loved: [], subjects: [], groupBest: new Map([['g', 90]]), groupBestSharp: new Map([['g', 85]]), groupSize: new Map([['g', 3]]) };
    const s = personalWhy({ ...base, sharpness: 50, aiScore: 40, status: 'rejected', aiDecided: true, groupId: 'g', personNames: [] }, ctx, tr);
    expect(s).toMatch(/^Am pus-o la Nu păstrez: e aproape la fel cu una mai clară din aceeași serie/);
  });
  it('cea mai bună din serie e spusă ca motiv de păstrare', () => {
    const ctx = { loved: [], subjects: [], groupBest: new Map([['g', 90]]), groupBestSharp: new Map([['g', 80]]), groupSize: new Map([['g', 3]]) };
    const s = personalWhy({ ...base, status: 'selected', aiDecided: true, groupId: 'g', personNames: [] }, ctx, tr);
    expect(s).toMatch(/^Am păstrat-o: e cea mai reușită din serie/);
  });
});
