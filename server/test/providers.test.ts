import { describe, expect, it } from 'vitest';
import { geminiGradeBody, gradeCacheKey, providerOrder, textFromGemini } from '../src/providers';

describe('furnizori AI', () => {
  it('pune Workers înaintea lui Gemini și sare numele necunoscute', () => {
    expect(providerOrder(undefined)).toEqual(['workers', 'gemini']);
    expect(providerOrder('gemini, workers, fal')).toEqual(['gemini', 'workers']);
    expect(providerOrder('nope')).toEqual(['workers']);
  });

  it('ține minte aceeași poză și deosebește alta', () => {
    const a = '/9j/' + 'a'.repeat(80);
    expect(gradeCacheKey(a)).toBe(gradeCacheKey(a));
    expect(gradeCacheKey(a)).not.toBe(gradeCacheKey('/9j/' + 'b'.repeat(80)));
  });

  it('cere lui Gemini poza și promptul, fără cheie în corp', () => {
    const body = geminiGradeBody('QUJD', 'look');
    const text = JSON.stringify(body);
    expect(text).toContain('QUJD');
    expect(text).toContain('look');
    expect(text).not.toMatch(/api[_-]?key/i);
  });

  it('citește textul din răspunsul Gemini', () => {
    expect(textFromGemini({ candidates: [{ content: { parts: [{ text: '{"exposure":1}' }] } }] })).toContain('exposure');
    expect(textFromGemini({})).toBe('');
  });
});
