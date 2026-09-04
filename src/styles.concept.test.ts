import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * styles.concept.css e stratul vizual portat din build-ul de referinta: intai
 * foaia de concept copiata ca atare, apoi foaia de "preview" de deasupra ei,
 * apoi blocurile de corectura. Ordinea conteaza — la specificitate egala
 * castiga ultima regula — si exact acolo s-au rupt doua lucruri deodata:
 * iconitele de pe carduri si eticheta butonului de export.
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

  it('spatiul de lucru e un strat opac, nu o pagina transparenta peste ecranul de acasa', () => {
    expect(winsOver('.workspace {\n  position: fixed;\n  inset: 0;', '.workspace {\n  min-height:100dvh;')).toBe(true);
  });
});

describe('randul de file al foii de metrici nu se poate turti', () => {
  /**
   * Bug real, raportat cu captura: "nu mai vad rubrica de ce acest scor".
   *
   * Filele erau acolo. Randul lor insa se micsora la ~31 px in loc de 64, iar
   * butoanele de 54 px ieseau taiate — pe telefon se vedea doar o dunga sub
   * "Editează". Cauza: `.detail-sheet-content` e o coloana flex cu inaltime
   * limitata, un element flex se micsoreaza implicit, iar `overflow-x: auto` de
   * pe acelasi rand il face container cu derulare, deci ce se turteste se TAIE
   * in loc sa iasa vizibil in afara.
   *
   * Nu era o problema cosmetica: filele "De ce acest scor", "Persoane" si
   * "Istoric" deveneau invizibile, iar butonul "de ce" de deasupra deciziei e
   * ascuns cat timp foaia e deschisa — deci nu mai exista NICIO cale catre
   * explicatia scorului.
   *
   * jsdom nu aplica foi externe, deci nu se poate masura aici inaltimea; se
   * verifica invariantul din sursa, care e chiar ce lipsea.
   */
  const bloc = css.slice(css.lastIndexOf('.detail-tabs {'), css.length);

  it('randul de file are flex-shrink: 0', () => {
    expect(bloc.slice(0, bloc.indexOf('}'))).toContain('flex-shrink: 0');
  });

  it('regula sta pe ACELASI bloc cu overflow-x, care e cealalta jumatate a cauzei', () => {
    // Separate, cineva le poate muta una fara alta si bugul revine tacut:
    // overflow fara flex-shrink taie, flex-shrink fara overflow doar deranjeaza.
    const primaAcolada = bloc.slice(0, bloc.indexOf('}'));
    expect(primaAcolada).toContain('overflow-x: auto');
    expect(primaAcolada).toContain('flex-shrink: 0');
  });
});
