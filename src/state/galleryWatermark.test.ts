import { describe, expect, it, beforeEach } from 'vitest';
import {
  readGalleryWatermark, writeGalleryWatermark, advanceGalleryWatermark,
  worthMentioning, MIN_NEW_PHOTOS_TO_MENTION
} from './galleryWatermark';

/**
 * state/galleryWatermark.test.ts
 *
 * Ce se poate strica aici nu da nicio eroare: memento-ul spune pur si simplu
 * un numar gresit de poze noi. Iar un numar gresit spus cu incredere e mai rau
 * decat niciun numar — omul deschide aplicatia, gaseste altceva decat i s-a
 * promis, si nu mai crede nici data viitoare.
 */
beforeEach(() => {
  localStorage.clear();
});

describe('semnul de carte', () => {
  it('lipseste la prima pornire — nu se inventeaza o valoare', () => {
    expect(readGalleryWatermark()).toBeNull();
  });

  it('se scrie si se citeste inapoi', () => {
    writeGalleryWatermark(1_700_000_000_000);
    expect(readGalleryWatermark()).toBe(1_700_000_000_000);
  });

  it('gunoiul din localStorage e tratat ca ABSENT, nu ca NaN', () => {
    // NaN ar trece de o garda `!== null` si abia apoi ar face fiecare
    // comparatie falsa — adica am numara poze "de la NaN incoace", deci
    // niciuna, in tacere.
    localStorage.setItem('lumin-gallery-watermark', 'aiurea');
    expect(readGalleryWatermark()).toBeNull();
  });

  it('o valoare negativa sau zero e tot absenta', () => {
    localStorage.setItem('lumin-gallery-watermark', '0');
    expect(readGalleryWatermark()).toBeNull();
    localStorage.setItem('lumin-gallery-watermark', '-5');
    expect(readGalleryWatermark()).toBeNull();
  });
});

describe('semnul de carte nu merge inapoi', () => {
  it('urca atunci cand galeria chiar are ceva mai nou', () => {
    writeGalleryWatermark(1000);
    advanceGalleryWatermark(2000);
    expect(readGalleryWatermark()).toBe(2000);
  });

  it('NU coboara — cazul "am adus Iulie dintr-o galerie care are poze de ieri"', () => {
    // Daca ar cobori, aplicatia ar anunta ca noi exact pozele pe care tocmai
    // le-a aratat. Semnul de carte raspunde la "pana unde am vazut galeria",
    // nu la "ce am adus ultima data".
    writeGalleryWatermark(2000);
    advanceGalleryWatermark(1000);
    expect(readGalleryWatermark()).toBe(2000);
  });

  it('o data necunoscuta (galerie goala, fara nicio data citibila) nu sterge ce stiam', () => {
    writeGalleryWatermark(2000);
    advanceGalleryWatermark(undefined);
    expect(readGalleryWatermark()).toBe(2000);
  });

  it('prima data cunoscuta se retine chiar daca nu exista niciuna inainte', () => {
    advanceGalleryWatermark(1500);
    expect(readGalleryWatermark()).toBe(1500);
  });
});

describe('cand merita spusa cifra', () => {
  it('nu pentru cateva poze — "ai 3 poze noi" nu e un motiv sa deschizi nimic', () => {
    expect(worthMentioning(0)).toBe(false);
    expect(worthMentioning(MIN_NEW_PHOTOS_TO_MENTION - 1)).toBe(false);
  });

  it('da, de la pragul in sus', () => {
    expect(worthMentioning(MIN_NEW_PHOTOS_TO_MENTION)).toBe(true);
    expect(worthMentioning(312)).toBe(true);
  });
});
