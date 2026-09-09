import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrastul textului pe suprafetele PLINE, verificat din foaia de stil.
 *
 * De ce un test si nu doar culorile corectate: auditul de dinaintea lansarii a
 * masurat 1,74:1 pe "Selecteaza" si 2,82:1 pe "Respinge" — cele mai apasate
 * doua butoane din produs — fiindca peste ele fusesera puse pastelurile
 * --pick/--reject, tunate pentru text colorat pe fundal aproape negru, sub o
 * eticheta ALBA. Nimic din cod nu impiedica pe cineva sa le puna la loc.
 *
 * jsdom nu aplica foi de stil externe, deci nu se poate masura randarea; se
 * citesc valorile declarate, care sunt oricum locul unde s-ar strica.
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

/** Raportul de contrast WCAG dintre doua culori (1:1 … 21:1). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Valoarea unui token `--nume: #rrggbb;` din foaia data (prima declaratie). */
function token(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source);
  expect(match, `tokenul ${name} nu mai e o culoare literala in foaie`).not.toBeNull();
  return match![1];
}

/** Minimul WCAG AA pentru text normal. */
const AA = 4.5;

describe('butoanele de decizie — eticheta alba pe fundal plin', () => {
  it('--pick-solid si --reject-solid trec pragul AA sub text alb', () => {
    expect(contrast(token(css, '--pick-solid'), '#ffffff')).toBeGreaterThanOrEqual(AA);
    expect(contrast(token(css, '--reject-solid'), '#ffffff')).toBeGreaterThanOrEqual(AA);
  });

  it('pastelurile vechi NU sunt destule — de-asta exista tokenii de mai sus', () => {
    expect(contrast(token(css, '--pick'), '#ffffff')).toBeLessThan(AA);
    expect(contrast(token(css, '--reject'), '#ffffff')).toBeLessThan(AA);
  });

  it('ambele foi pun tokenii pe butoane, nu culoarea pastel', () => {
    for (const source of [css, conceptCss]) {
      expect(source).toMatch(/\.detail-fab-select\s*\{[^}]*var\(--pick-solid\)/);
      expect(source).toMatch(/\.detail-fab-reject\s*\{[^}]*var\(--reject-solid\)/);
    }
  });

  it('badge-urile de swipe stau pe umplere opaca, nu pe o tenta peste fotografie', () => {
    expect(css).toMatch(/\.swipe-badge-select\s*\{[^}]*background:\s*var\(--pick-solid\)/);
    expect(css).toMatch(/\.swipe-badge-reject\s*\{[^}]*background:\s*var\(--reject-solid\)/);
  });
});

describe('paleta "desk" are o singura definitie', () => {
  /**
   * styles.concept.css se importa DUPA styles.css, deci orice token redefinit
   * acolo castiga in tema intunecata si pierde in cea luminoasa (unde
   * :root[data-theme="light"] are specificitate mai mare). Asa a ajuns
   * --desk-aqua sa fie cyan pe intuneric si teal pe lumina, fara ca nimeni sa
   * fi ales asta.
   */
  it('foaia de concept nu redefineste tokenii --desk-*', () => {
    expect(conceptCss).not.toMatch(/--desk-(bg|panel|panel-soft|line|ink|muted|aqua|red)\s*:/);
  });

  it('styles.css ii defineste pentru ambele teme', () => {
    expect(css).toMatch(/--desk-aqua:\s*#67e4cf/);
    const light = css.slice(css.indexOf(':root[data-theme="light"]'));
    expect(light).toMatch(/--desk-aqua:\s*#0e7490/);
  });
});

describe('ecranele pe care se judeca pozele', () => {
  /**
   * Regula e scrisa in styles.css, la tema luminoasa: zonele unde se JUDECA
   * pozele raman aproape negre in ambele teme. Spatiul de lucru — ecranul cel
   * mai folosit din aplicatie — era singurul care n-o respecta: antetul si bara
   * de jos sunt inchise si fixe, dar fundalul urma tema, deci pe lumina ieseau
   * doua benzi inchise pe un fond deschis.
   */
  it('spatiul de lucru si sortarea rapida nu urmeaza tema pe fundal', () => {
    expect(conceptCss).toMatch(/\.workspace \{[^}]*background: #050608/);
    expect(conceptCss).toMatch(/\.tiktok-sort \{[^}]*background:#050608/);
  });

  it('exista o zona de atingere de 44px care nu misca asezarea', () => {
    expect(css).toMatch(/\.tap-44::after \{[^}]*width: max\(100%, 44px\)/);
    expect(css).toMatch(/\.tap-44::after \{[^}]*height: max\(100%, 44px\)/);
  });
});

describe('insigna PRO din antet', () => {
  it('foloseste nuanta de TEXT a accentului secundar, nu culoarea plina', () => {
    expect(css).toMatch(/\.brand-pro-badge\s*\{[^}]*color:\s*var\(--accent-2-text\)/);
  });

  it('pe tema luminoasa, nuanta aia trece pragul AA pe suprafata alba', () => {
    const light = css.slice(css.indexOf(':root[data-theme="light"]'));
    expect(contrast(token(light, '--accent-2-text'), '#ffffff')).toBeGreaterThanOrEqual(AA);
  });
});
