import { describe, it, expect, beforeEach } from 'vitest';
import {
  readFeedback, recordFeedback, resetFeedback, summariseFeedback,
  FEEDBACK_REASONS, MAX_ENTRIES
} from './aiFeedback';

describe('aiFeedback', () => {
  beforeEach(() => localStorage.clear());

  it('porneste gol', () => {
    expect(readFeedback()).toEqual([]);
    expect(summariseFeedback()).toEqual([]);
  });

  it('inregistreaza motivul, momentul si scorul', () => {
    recordFeedback('wrongPick', 88, 1000);
    expect(readFeedback()).toEqual([{ reason: 'wrongPick', ts: 1000, score: 88 }]);
  });

  it('rotunjeste scorul si il omite cand lipseste sau e imposibil', () => {
    recordFeedback('tooSlow', 71.6, 1);
    recordFeedback('tooSlow', undefined, 2);
    recordFeedback('tooSlow', Number.NaN, 3);
    expect(readFeedback().map(e => e.score)).toEqual([72, undefined, undefined]);
  });

  it('nu creste la nesfarsit — pastreaza cele mai NOI raportari', () => {
    for (let i = 0; i < MAX_ENTRIES + 50; i++) recordFeedback('other', undefined, i);
    const all = readFeedback();
    expect(all.length).toBe(MAX_ENTRIES);
    expect(all[all.length - 1].ts).toBe(MAX_ENTRIES + 49);
  });

  it('nu retine nimic care ar identifica poza', () => {
    recordFeedback('missedClosedEyes', 40, 5);
    const raw = localStorage.getItem('lumin-ai-feedback') ?? '';
    // doar cele trei campuri asteptate; niciun id, nume sau cale
    expect(Object.keys(readFeedback()[0]).sort()).toEqual(['reason', 'score', 'ts']);
    expect(raw).not.toMatch(/\.(jpg|jpeg|png|heic|cr2|nef)/i);
  });

  it('ignora intrarile corupte sau cu motive necunoscute', () => {
    localStorage.setItem('lumin-ai-feedback', JSON.stringify([
      { reason: 'wrongPick', ts: 1 },
      { reason: 'inventat', ts: 2 },
      { reason: 'tooSlow' },
      'nu e obiect',
      { reason: 'other', ts: 'ieri' }
    ]));
    expect(readFeedback()).toEqual([{ reason: 'wrongPick', ts: 1 }]);
  });

  it('nu arunca pe stocare corupta', () => {
    localStorage.setItem('lumin-ai-feedback', 'nu e json');
    expect(readFeedback()).toEqual([]);
  });

  it('rezuma pe motive, descrescator dupa numar', () => {
    recordFeedback('tooSlow', undefined, 1);
    recordFeedback('wrongPick', 90, 2);
    recordFeedback('wrongPick', 80, 3);
    const s = summariseFeedback();
    expect(s[0]).toEqual({ reason: 'wrongPick', count: 2, avgScore: 85 });
    expect(s[1]).toEqual({ reason: 'tooSlow', count: 1, avgScore: null });
  });

  it('la egalitate de numar, pastreaza ordinea declarata a motivelor', () => {
    recordFeedback('other', undefined, 1);
    recordFeedback('wrongPick', undefined, 2);
    expect(summariseFeedback().map(s => s.reason)).toEqual(['wrongPick', 'other']);
  });

  it('raporteaza doar motivele folosite, nu o lista de zerouri', () => {
    recordFeedback('wrongPick', undefined, 1);
    expect(summariseFeedback().length).toBe(1);
    expect(FEEDBACK_REASONS.length).toBeGreaterThan(1);
  });

  it('resetul sterge tot', () => {
    recordFeedback('other', undefined, 1);
    resetFeedback();
    expect(readFeedback()).toEqual([]);
  });
});
