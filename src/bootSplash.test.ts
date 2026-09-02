import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * src/bootSplash.test.ts
 * Ecranul desenat inainte de JavaScript (vezi marcajul din index.html) sta pe
 * DOUA presupuneri care nu produc nicio eroare cand se strica — doar un ecran
 * urat sau, mai rau, unul care nu mai pleaca:
 *
 *  1. clasele pe care le imprumuta de la ecranul de start CHIAR exista in foaia
 *     de stil. Redenumite, splash-ul devine text negru pe negru, si nimeni nu
 *     afla pana nu deschide aplicatia pe un telefon incet;
 *  2. `createRoot(...).render()` goleste containerul la primul commit. Daca
 *     n-ar face-o, medalionul ar ramane peste aplicatie pentru totdeauna.
 *
 * A doua verifica un comportament al lui React, nu al nostru — dinadins: e
 * exact genul de presupunere pe care o actualizare de biblioteca o poate
 * schimba tacut, si singurul loc din aplicatie unde ne bazam pe ea.
 */
const root = resolve(__dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8')
  + readFileSync(resolve(root, 'src/styles.concept.css'), 'utf8');

describe('ecranul de dinainte de JavaScript', () => {
  it('sta in #root, ca sa poata fi sters de prima randare', () => {
    expect(html).toMatch(/<div id="root">\s*<div class="boot-splash">/);
  });

  it.each(['boot-splash', 'empty-badge', 'empty-badge-mark'])(
    'clasa .%s, folosita in index.html, exista in foaia de stil',
    cls => {
      expect(html).toContain(`class="${cls}"`);
      expect(css).toContain(`.${cls}`);
    }
  );

  it('medalionul e marcat decorativ — un cititor de ecran n-are ce citi din doua litere', () => {
    expect(html).toMatch(/<div class="empty-badge" aria-hidden="true">/);
  });

  it('prima randare React goleste containerul, deci splash-ul dispare singur', () => {
    // React cere flag-ul asta ca sa accepte `act` in afara lui
    // @testing-library/react, care il pune singur cand se foloseste `render`.
    // Aici avem nevoie de un container CRUD, cu copii pusi de noi inainte —
    // exact situatia pe care o are pagina reala la pornire.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    container.innerHTML = '<div class="boot-splash">marca</div>';
    document.body.appendChild(container);

    act(() => { createRoot(container).render(createElement('p', null, 'aplicatia')); });

    expect(container.querySelector('.boot-splash')).toBeNull();
    expect(container.textContent).toBe('aplicatia');
    container.remove();
  });
});
