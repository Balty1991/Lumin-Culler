import { describe, expect, it } from 'vitest';
import { returnVisitPrompt, SAME_SESSION_MS } from './returnVisit';

/**
 * state/returnVisit.test.ts
 * "A doua deschidere e complet goala. Nimic care sa spuna ce s-a schimbat sau
 * ce merita facut acum." — auditul de dinaintea lansarii. Testele de aici
 * apara doua lucruri: ca randul APARE cand exista ceva de spus, si ca TACE cand
 * nu exista (o prima sesiune, sau aceeasi sesiune reintrata dupa doua minute).
 */
const NOW = 1_800_000_000_000;
const ZI = 24 * 60 * 60 * 1000;

function input(over: Partial<Parameters<typeof returnVisitPrompt>[0]> = {}) {
  return {
    now: NOW, lastVisitAt: NOW - ZI,
    importedSinceLastVisit: 0, undecided: 0, galleryNew: null,
    ...over
  };
}

describe('randul de la a doua deschidere', () => {
  it('prima sesiune nu primeste nimic — acolo e ecranul de bun venit', () => {
    expect(returnVisitPrompt(input({ lastVisitAt: null, undecided: 40 }))).toBeNull();
  });

  it('doua deschideri la cateva minute sunt aceeasi sesiune, nu o revenire', () => {
    expect(returnVisitPrompt(input({ lastVisitAt: NOW - SAME_SESSION_MS + 1000, undecided: 40 }))).toBeNull();
  });

  it('munca inceputa trece inaintea muncii amanate', () => {
    const prompt = returnVisitPrompt(input({ importedSinceLastVisit: 12, undecided: 40 }));
    expect(prompt).toEqual({ key: 'returnVisit.newImported', params: { count: 12 }, action: 'sort' });
  });

  it('fara poze noi, spune ce a ramas', () => {
    expect(returnVisitPrompt(input({ undecided: 40 }))?.key).toBe('returnVisit.leftOver');
  });

  it('cu tot triat si galeria plina, trimite spre import', () => {
    const prompt = returnVisitPrompt(input({ galleryNew: 312 }));
    expect(prompt).toEqual({ key: 'returnVisit.galleryNew', params: { count: 312 }, action: 'import' });
  });

  it('cand nu e nimic de facut, spune si asta — nu tace', () => {
    expect(returnVisitPrompt(input())?.key).toBe('returnVisit.allClear');
  });

  it('o galerie fara cifra cunoscuta nu inventeaza una', () => {
    expect(returnVisitPrompt(input({ galleryNew: null }))?.key).toBe('returnVisit.allClear');
    expect(returnVisitPrompt(input({ galleryNew: 0 }))?.key).toBe('returnVisit.allClear');
  });
});
