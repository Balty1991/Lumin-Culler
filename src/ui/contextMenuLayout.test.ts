import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Doua bug-uri vizuale raportate pe device, amandoua invizibile pentru testele
 * de componenta (jsdom nu face layout si nu compune straturi):
 *
 *   "eticheta culori, depaseste blocul"
 *   "cand apas pe folder, apare in spatele ferestrei"
 *
 * Amandoua se reduc la relatii NUMERICE intre valori din styles.css, deci le
 * verificam ca atare — nu valori literale (care s-ar invechi la primul retus
 * de design), ci invarianta din spatele lor: bulinele TREBUIE sa incapa in
 * meniu, iar dropdown-urile TREBUIE sa fie deasupra meniului care le deschide.
 */
// vitest ruleaza din radacina proiectului (vezi vitest.config.ts); import.meta.url nu
// e un URL de tip file in mediul jsdom, deci rezolvam fata de cwd.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function px(pattern: RegExp): number {
  const m = css.match(pattern);
  if (!m) throw new Error(`nu am gasit in styles.css: ${pattern}`);
  return Number(m[1]);
}

describe('meniul contextual — invariante de layout', () => {
  it('cele 5 buline de eticheta incap pe latimea meniului, cu tot cu padding-uri', () => {
    const menuWidth = px(/\.context-menu \{[^}]*?width: (\d+)px/s);
    const menuPad = px(/\.context-menu \{[^}]*?padding: (\d+)px/s);
    const swatch = px(/\.color-label-swatch \{[^}]*?width: (\d+)px/s);
    const swatchGap = px(/\.color-label-swatches \{[^}]*?gap: (\d+)px/s);
    const rowPad = px(/\.context-menu-color-labels \{[^}]*?padding: \d+px (\d+)px/s);

    // 5 buline (COLOR_LABELS) + 4 spatii intre ele
    const swatchesWidth = 5 * swatch + 4 * swatchGap;
    const available = menuWidth - 2 * menuPad - 2 * rowPad;

    expect(available).toBeGreaterThanOrEqual(swatchesWidth);
  });

  it('randul de etichete se rupe pe linie proprie in loc sa dea pe dinafara', () => {
    // fara wrap, un rand prea lat nu se muta pe linia urmatoare, ci iese din meniu
    const row = css.match(/\.context-menu-color-labels \{[^}]*\}/s)?.[0] ?? '';
    expect(row).toMatch(/flex-wrap:\s*wrap/);
  });

  it('dropdown-urile randate prin portal stau DEASUPRA meniului contextual care le deschide', () => {
    const dropdown = px(/--z-dropdown: (\d+)/);
    const contextMenu = px(/--z-context-menu: (\d+)/);

    expect(dropdown).toBeGreaterThan(contextMenu);
  });

  it('popover-ul de foldere chiar foloseste acel strat, nu o valoare fixa', () => {
    const menu = css.match(/\.scene-tag-filter-menu \{[^}]*\}/s)?.[0] ?? '';
    expect(menu).toMatch(/z-index:\s*var\(--z-dropdown\)/);
  });

  it('dropdown-urile raman totusi sub toast-uri (un rezultat de export nu trebuie acoperit)', () => {
    expect(px(/--z-dropdown: (\d+)/)).toBeLessThan(px(/--z-toast: (\d+)/));
  });
});
