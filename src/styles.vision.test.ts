import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * src/styles.vision.test.ts
 * Regulile redesignului "Camera obscura", apărate din foaie.
 *
 * Macheta: https://claude.ai/code/artifact/d895fa1d-f595-48a1-876e-0cfdb679b853
 *
 * Doua dintre cele cinci reguli se pot strica in tacere, si amandoua s-au
 * stricat deja o data — a doua chiar in machetele mele, la prima incercare:
 *
 *  1. spectralul violet->cyan e semnul MOTORULUI. Daca reapare pe butoane,
 *     pastile si file active, redevine ce era: decoratie care nu inseamna
 *     nimic. Testul tine o lista scurta de suprafete care au voie sa-l atinga;
 *     orice alt selector care il cere pica aici, nu pe telefon.
 *  2. actiunea principala e LUMINA, nu culoare. `.btn-accent` purta chiar
 *     gradientul motorului.
 *
 * Nu masoara aspect — jsdom nu aplica foi externe. Apara invariantele din care
 * aspectul iese.
 */
const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
const conceptCss = readFileSync(resolve(__dirname, 'styles.concept.css'), 'utf8');

/** Luminanta relativa WCAG 2.1 a unei culori #rrggbb. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source);
  expect(match, `tokenul ${name} nu mai e o culoare literala in foaie`).not.toBeNull();
  return match![1];
}

/**
 * Suprafetele care au voie sa ceara token-ii motorului. Lista e SCURTA
 * deliberat: fiecare intrare noua aici slabeste regula, deci se adauga doar
 * impreuna cu motivul pentru care acel element chiar e motorul care vorbeste.
 */
const SUPRAFETE_MOTOR = [
  '.engine-ring',         // inelul de scor
  '.engine-chip',         // pastila de verdict AI
  '.engine-progress',     // progresul analizei
  // Ecranul de incarcare a modelelor. Intrare adaugata cu motiv, nu din
  // comoditate: aici nu e o suprafata care VORBESTE DESPRE motor, e motorul
  // insusi, vizibil lucrand — singurul moment din aplicatie cand nu se
  // intampla nimic altceva. Daca spectralul nu are ce cauta aici, atunci nu
  // are ce cauta nicaieri, si regula n-ar mai avea niciun continut.
  '.analysis-studio'
];

/**
 * Blocurile `selector { ... }` din foaie, fara comentarii.
 *
 * Regulile care se termina in `;` (`@import`, `@charset`) nu au acolade, deci
 * cad in fata selectorului urmator; le taiem, altfel primul `:root` din foaie
 * se prezinta drept `@import '...' ... :root` si scapa de filtre.
 */
function blocks(source: string): { selector: string; body: string }[] {
  const fara = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fara)) !== null) {
    const selector = m[1].slice(m[1].lastIndexOf(';') + 1).trim();
    out.push({ selector, body: m[2] });
  }
  return out;
}

describe('spectralul e al motorului, si al nimanui altcuiva', () => {
  it.each([['styles.css', css], ['styles.concept.css', conceptCss]])(
    '%s: niciun selector din afara listei nu cere token-ii motorului',
    (_nume, source) => {
      const vinovati = blocks(source)
        .filter(b => /var\(--engine-/.test(b.body))
        // `:root` ii DEFINESTE, nu ii foloseste.
        .filter(b => !/^:root/.test(b.selector))
        .filter(b => !SUPRAFETE_MOTOR.some(s => b.selector.includes(s)))
        .map(b => b.selector);
      expect(vinovati).toEqual([]);
    }
  );

  it('gradientul motorului exista si e chiar perechea violet -> cyan', () => {
    expect(css).toMatch(/--engine-1:\s*#8b5cf6/);
    expect(css).toMatch(/--engine-2:\s*#22d3ee/);
    expect(css).toMatch(/--engine-grad:\s*linear-gradient/);
  });
});

describe('actiunea principala e lumina, nu culoare', () => {
  it('butonul accentuat nu poarta semnul motorului', () => {
    const btn = blocks(css).find(b => b.selector === '.btn-accent');
    expect(btn, '.btn-accent a disparut din foaie').toBeTruthy();
    // Accentul ALES DE UTILIZATOR (Aspect) e binevenit aici — el nu inseamna
    // "aici a masurat masina". Spectralul motorului nu are ce cauta.
    expect(btn!.body).not.toContain('--engine-grad');
  });

  /**
   * LUMINA E RARA, si testul asta exista fiindca eu am incalcat regula primul.
   *
   * In faza 1 am pus lespedea de lumina pe `.btn-accent` — clasa folosita in
   * vreo paisprezece locuri. Rezultatul: alb peste tot, deci lumina a incetat
   * sa mai insemne "asta e lucrul principal" si a devenit "asta e un buton".
   * Aceeasi eroare ca un gradient pus pe orice, doar mai zgomotoasa.
   *
   * Lista de mai jos e scurta deliberat: fiecare intrare noua trebuie sa fie
   * un ecran care chiar are o SINGURA actiune dominanta.
   */
  /**
   * Lista e GOALA acum, si asta e raspunsul real, nu o omisiune.
   *
   * Am mutat intai `.btn-accent` pe lumina; utilizatorul a semnalat butoanele
   * albe. Am corectat, dar am pastrat lumina pe "singura actiune dominanta a
   * ecranului" (butonul Continua de pe Acasa). A semnalat-o si pe aceea.
   *
   * Doua semnalari la rand pe acelasi lucru nu mai sunt o preferinta de
   * detaliu: regula "actiunea principala e LUMINA" nu e regula acestei
   * aplicatii. Ea are un accent pe care omul si-l alege din Aspect, iar
   * actiunea principala e exact locul unde acel accent se vede.
   *
   * Testul ramane, cu lista goala, ca lumina sa nu se strecoare inapoi din
   * inertie — inclusiv de la mine.
   */
  it('lespedea de lumina nu se mai foloseste ca fundal de buton', () => {
    const PERMISE: string[] = [];
    for (const source of [css, conceptCss]) {
      const vinovati = blocks(source)
        .filter(b => !/^:root/.test(b.selector))
        .filter(b => /background:[^;]*var\(--light-primary\)/.test(b.body))
        .filter(b => !PERMISE.some(sel => b.selector.includes(sel)))
        .map(b => b.selector);
      expect(vinovati).toEqual([]);
    }
  });

  it('textul de pe lespedea de lumina se citeste — cu mult peste pragul AA', () => {
    const fundal = token(css, '--light-primary');
    const text = token(css, '--light-primary-ink');
    expect(contrast(fundal, text)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('primitivele limbajului de lumina exista', () => {
  // '.lc-anchor' a iesit din lista odata cu stratul de pe fotografie: patru
  // incercari de a-l face sa arate bine, si raspunsul utilizatorului a ramas
  // acelasi. Ce spunea el spune deja panoul de scor de sub poza.
  it.each(['.lc-slab', '.lc-edge', '.lc-micro'])('%s e definit', sel => {
    expect(blocks(css).some(b => b.selector.split(',').some(s => s.trim() === sel))).toBe(true);
  });

  it('muchia e o linie care se stinge, nu un fundal opac', () => {
    const edge = blocks(css).find(b => b.selector === '.lc-edge::before');
    expect(edge, '.lc-edge::before a disparut').toBeTruthy();
    expect(edge!.body).toContain('var(--edge-lit)');
    expect(css).toMatch(/--edge-lit:\s*linear-gradient\(90deg,\s*transparent/);
  });
});
