import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ui/bottomNavPill.test.ts
 * Pastila de sub fila activa trebuie sa cada FIX peste fila ei.
 *
 * Doua nepotriviri au trait aici deodata, amandoua invizibile cat pastila a
 * fost palida, si amandoua raportate in aceeasi propozitie de utilizator
 * ("iconita nu e centrata in casuta") in clipa in care s-a luminat:
 *
 *  1. pista pastilei era pozitionata absolut fata de cutia CU padding a barei,
 *     iar filele traiesc in cutia de continut — cinci coloane egale pe o
 *     latime mai mare decat cele cinci file;
 *  2. `translateX(100%)` muta pastila cu propria ei latime, nu cu a coloanei.
 *     Marginea o ingusteaza cu 2 x --pill-gap, deci fiecare pas ramanea in
 *     urma cu atat: 12px la prima fila, 48px la a patra.
 *
 * Amandoua se repara punand acelasi numar in doua locuri. De-aia sunt acum
 * VARIABILE, si de-aia exista testul asta: literalele se despart in tacere, si
 * singurul semn ca s-au despartit e ceva ce trebuie sa observi cu ochiul.
 */
const css = readFileSync(resolve(__dirname, '..', 'styles.concept.css'), 'utf8');

function bloc(selector: string): string {
  const m = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  expect(m, `${selector} a disparut din foaie`).not.toBeNull();
  return m![1];
}

describe('pastila barei de jos sta peste fila ei', () => {
  it('bara isi tine padding-ul intr-o variabila, nu intr-un numar', () => {
    expect(bloc('.bottom-nav')).toMatch(/--nav-pad:\s*\d/);
    expect(bloc('.bottom-nav')).toMatch(/padding:\s*0\s+var\(--nav-pad\)/);
  });

  it('pista se retrage cu ACELASI padding, ca sa acopere exact zona filelor', () => {
    expect(bloc('.bottom-nav-pill-track')).toMatch(/inset:[^;]*var\(--nav-pad/);
  });

  it('pasul de deplasare include marginea, altfel pastila ramane in urma', () => {
    const pill = bloc('.bottom-nav-pill');
    expect(pill).toMatch(/--pill-gap:\s*\d/);
    expect(pill).toMatch(/margin:\s*0\s+var\(--pill-gap\)/);
    // `100%` singur ar fi latimea pastilei, nu a coloanei — exact bug-ul.
    expect(pill).toMatch(/translateX\(calc\(var\(--nav-active[^)]*\)\s*\*\s*\(100%\s*\+\s*var\(--pill-gap\)\s*\*\s*2\)\)\)/);
  });

  it('fila activa NU-si pune fundal propriu — pastila e singurul indicator', () => {
    // Vezi BottomNav.tsx: pastila e un element care se plimba peste bara, deci
    // un al doilea fundal ar arata DOUA evidentieri cat tine tranzitia.
    expect(css).toMatch(/\.bottom-nav-tab\.active\s*\{[^}]*background:\s*none/);
  });
});
