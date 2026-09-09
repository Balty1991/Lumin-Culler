import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEIL_TOP_PX, VEIL_BOTTOM_PX } from './TikTokSort';

/**
 * ui/photoAnchors.chrome.test.ts
 * Benzile acoperite de comenzi sunt scrise si in JS, si in foaie. Aici se
 * verifica ca n-au apucat sa se despartă.
 *
 * Ancorele sunt aruncate cand ar cadea sub comenzi (vezi core/photoAnchors.ts).
 * Daca valul de umbra din foaie creste si numarul din TikTokSort.tsx ramane pe
 * loc, ancorele nu dispar si nu dau eroare — se deseneaza in continuare, doar
 * ca sub o umbra care le inghite. Un defect care arata ca "uneori nu se vede
 * eticheta", adica unul pe care nimeni nu-l raporteaza si nimeni nu-l cauta.
 */
const css = readFileSync(resolve(__dirname, '..', 'styles.css'), 'utf8');

function inaltimeaRegulii(selector: string): number {
  const bloc = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  expect(bloc, `${selector} a disparut din foaie`).not.toBeNull();
  const h = /height:\s*(\d+)px/.exec(bloc![1]);
  expect(h, `${selector} nu mai are o inaltime fixa`).not.toBeNull();
  return Number(h![1]);
}

describe('benzile de comenzi din sortarea rapida', () => {
  it('valul de sus e cat spune TikTokSort ca e', () => {
    expect(inaltimeaRegulii('.tiktok-veil-top')).toBe(VEIL_TOP_PX);
  });

  it('valul de jos e cat spune TikTokSort ca e', () => {
    expect(inaltimeaRegulii('.tiktok-veil-bottom')).toBe(VEIL_BOTTOM_PX);
  });
});
