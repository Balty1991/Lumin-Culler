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
  '.lc-anchor',           // ancora de pe fotografie — motorul arata unde a masurat
  '.engine-ring',         // inelul de scor
  '.engine-chip',         // pastila de verdict AI
  '.engine-progress'      // progresul analizei
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
  it('butonul principal nu mai poarta semnul motorului', () => {
    const btn = blocks(css).find(b => b.selector === '.btn-accent');
    expect(btn, '.btn-accent a disparut din foaie').toBeTruthy();
    expect(btn!.body).toContain('var(--light-primary)');
    expect(btn!.body).not.toContain('--accent-gradient');
    expect(btn!.body).not.toContain('--engine-grad');
  });

  it('textul de pe lespedea de lumina se citeste — cu mult peste pragul AA', () => {
    const fundal = token(css, '--light-primary');
    const text = token(css, '--light-primary-ink');
    expect(contrast(fundal, text)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('primitivele limbajului de lumina exista', () => {
  it.each(['.lc-slab', '.lc-edge', '.lc-micro', '.lc-anchor'])('%s e definit', sel => {
    expect(blocks(css).some(b => b.selector.split(',').some(s => s.trim() === sel))).toBe(true);
  });

  it('muchia e o linie care se stinge, nu un fundal opac', () => {
    const edge = blocks(css).find(b => b.selector === '.lc-edge::before');
    expect(edge, '.lc-edge::before a disparut').toBeTruthy();
    expect(edge!.body).toContain('var(--edge-lit)');
    expect(css).toMatch(/--edge-lit:\s*linear-gradient\(90deg,\s*transparent/);
  });
});
