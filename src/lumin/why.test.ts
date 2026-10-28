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
    expect(s).toMatch(/^Ai păstra-o: e Angi — păstrezi 9 din 10 poze cu Angi/);
  });
  it('spune de ce n-ai păstra-o', () => {
    const s = personalWhy({ ...base, sharpness: 20, allEyesOpen: false, bestSmile: 0, aiScore: 20, status: 'rejected', personNames: [] }, { loved: [], subjects: [] }, tr);
    expect(s).toContain('N-ai păstra-o');
    expect(s).toContain('mișcată');
  });
});
