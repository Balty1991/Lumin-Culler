import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * styles.concept.css e stratul vizual portat din build-ul de referinta: intai
 * foaia de concept copiata ca atare, apoi foaia de "preview" de deasupra ei,
 * apoi blocurile de corectura. Ordinea conteaza — la specificitate egala
 * castiga ultima regula — si exact acolo s-au rupt trei lucruri deodata:
 * iconitele de pe carduri, eticheta butonului de export si perechile
 * buton/eticheta din bara de decizie.
 *
 * Testele de mai jos nu masoara layout (jsdom nu aplica foi de stil externe);
 * verifica invariantul de ORDINE care face ca acele corecturi sa ajunga la
 * utilizator. Daca cineva mai adauga o portie din foaia de preview la sfarsit,
 * pica aici, nu pe telefon.
 */
const css = readFileSync(resolve(__dirname, 'styles.concept.css'), 'utf8');

/** Ultima aparitie a lui `needle` trebuie sa fie dupa ultima aparitie a lui `shadowed`. */
function winsOver(needle: string, shadowed: string): boolean {
  const a = css.lastIndexOf(needle);
  const b = css.lastIndexOf(shadowed);
  expect(a, `lipseste din foaie: ${needle}`).toBeGreaterThan(-1);
  expect(b, `lipseste din foaie: ${shadowed}`).toBeGreaterThan(-1);
  return a > b;
}

describe('styles.concept.css — corecturile raman dupa regulile pe care le anuleaza', () => {
  it('iconitele de pe cardurile din grila nu raman ascunse', () => {
    // Foaia de preview avea `.grid .card .badges { display:none }` si, pe
    // ecrane tactile, ascundea tot `.card-top-left` / `.card-strip`.
    expect(winsOver(
      '.grid .card .badges,\n.grid .card .golden-badge,\n.grid .card .edited-badge {\n  display: flex;',
      '.grid .card .badges,\n.grid .card .golden-badge,\n.grid .card .edited-badge {\n  display:none;'
    )).toBe(true);
    expect(winsOver('.grid .card-top-left { display: flex; }', '.grid .card-top-left,\n  .grid .card-strip {\n    display:none;')).toBe(true);
  });

  it('celula din bara de decizie ramane o cutie proprie, ca eticheta sa nu plece de pe butonul ei', () => {
    // `.tiktok-rail-item { display: contents }` + etichete vizibile = grila
    // primeste 8 copii (4 etichete fara `order`, apoi 4 butoane cu `order`),
    // deci "Păstrez" ajunge sub butonul de stergere.
    expect(winsOver('.tiktok-rail-item { display: flex; }', '.tiktok-rail-item {\n  display:contents;\n}')).toBe(true);
  });

  it('ordinea vizuala a barei de decizie trece pe celule, nu pe butoane', () => {
    for (const cls of ['rail-del', 'rail-album', 'rail-keep', 'rail-undo']) {
      expect(css).toContain(`.tiktok-rail .${cls} { order:`);
    }
    expect(winsOver(
      '.tiktok-rail-btn.keep,\n  .tiktok-rail-btn.del,\n  .tiktok-rail .album,\n  .tiktok-rail-btn.undo { order: 0; }',
      '.tiktok-rail-btn.keep {\n  order:3;'
    )).toBe(true);
  });

  it('spatiul de lucru e un strat opac, nu o pagina transparenta peste ecranul de acasa', () => {
    expect(winsOver('.workspace {\n  position: fixed;\n  inset: 0;', '.workspace {\n  min-height:100dvh;')).toBe(true);
  });
});
