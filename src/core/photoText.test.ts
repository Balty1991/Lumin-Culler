import { describe, expect, it } from 'vitest';
import { photoTextFromBlocks, textSnippet, MAX_PHOTO_TEXT, MIN_PHOTO_TEXT } from './photoText';
import { normalizeForSearch } from './sceneTagLabels';

describe('textul citit din poza, pregatit pentru cautare', () => {
  it('lipeste blocurile si strange spatiile albe intr-unul singur', () => {
    // ML Kit da text pe blocuri, fiecare cu treceri la rand in interior.
    // Fara normalizare, "cod\n  wifi" n-ar fi gasit cautand "cod wifi".
    const out = photoTextFromBlocks([{ text: 'Parola\n  wifi' }, { text: 'ABC12345' }]);
    expect(out).toBe('Parola wifi ABC12345');
  });

  it('cateva caractere razlete NU sunt text — sunt zgomot', () => {
    // O litera pe o cutie, doua caractere ghicite dintr-o textura. Pastrate ca
    // text cautabil, ar da potriviri care par magice si sunt intamplatoare.
    expect(photoTextFromBlocks([{ text: 'AB' }])).toBeUndefined();
    expect(photoTextFromBlocks([{ text: '' }])).toBeUndefined();
    expect(photoTextFromBlocks([])).toBeUndefined();
  });

  it('exact la prag se pastreaza', () => {
    expect(photoTextFromBlocks([{ text: 'x'.repeat(MIN_PHOTO_TEXT) }])).toHaveLength(MIN_PHOTO_TEXT);
  });

  it('un document lung se taie, ca 5000 de poze sa nu umfle baza', () => {
    const out = photoTextFromBlocks([{ text: 'a'.repeat(MAX_PHOTO_TEXT + 500) }]);
    expect(out).toHaveLength(MAX_PHOTO_TEXT);
  });

  it('absent, nu sir gol — ca restul campurilor optionale din AnalysisRecord', () => {
    expect(photoTextFromBlocks([{ text: '   \n  ' }])).toBeUndefined();
  });
});

describe('bucata de text aratata langa rezultat', () => {
  const text = 'Bon fiscal service auto, total 349,50 lei, garantie 12 luni';
  const norm = normalizeForSearch(text);

  it('arata randul in care chiar scrie cuvantul cautat', () => {
    expect(textSnippet(text, norm, 'garantie')).toContain('garantie');
  });

  it('taie cu puncte de suspensie cand a mai ramas text de o parte si de alta', () => {
    const lung = 'x'.repeat(200) + ' parola secreta ' + 'y'.repeat(200);
    const out = textSnippet(lung, normalizeForSearch(lung), 'parola')!;
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('parola');
  });

  it('decupeaza din textul ORIGINAL, cu diacritice, desi cauta pe cel normalizat', () => {
    // normalizeForSearch scoate accentele de pe litere, nu litere — deci
    // lungimea nu se schimba si indicii raman valabili pe sirul original.
    const cu = 'chitanță pentru grădiniță';
    expect(textSnippet(cu, normalizeForSearch(cu), 'gradinita')).toContain('grădiniță');
  });

  it('fara potrivire, nimic', () => {
    expect(textSnippet(text, norm, 'pisica')).toBeUndefined();
  });
});
