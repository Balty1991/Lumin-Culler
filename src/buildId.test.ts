import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * src/buildId.test.ts
 * Eticheta build-ului, aratata in Meniu -> Ajutor.
 *
 * Ce se poate strica aici nu da nicio eroare: `__BUILD_ID__` ramane nedefinit,
 * randul afiseaza "undefined", si nimeni nu observa pana cand un tester trimite
 * un raport cu versiunea "undefined" in el — adica exact in clipa in care aveai
 * nevoie de ea.
 */
const config = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf8');

describe('eticheta build-ului', () => {
  it('simbolul exista la rulare, deci randarea nu arunca', () => {
    // Sub vitest valoarea vine din vitest.config.ts, nu din build-ul real:
    // ce se verifica aici e ca `__BUILD_ID__` EXISTA, fiindca o componenta
    // care citeste un simbol nedefinit arunca ReferenceError la randare.
    // Ca eticheta reala ajunge in productie o verifica testele de mai jos,
    // citind vite.config.ts.
    expect(typeof __BUILD_ID__).toBe('string');
    expect(__BUILD_ID__.length).toBeGreaterThan(0);
  });

  it('build-ul real compune data si sha-ul scurt', () => {
    // Data exista mereu; sha-ul poate lipsi (arhiva fara git, checkout fara
    // istoric), si atunci ramane doar data — niciodata gol.
    expect(config).toContain("new Date().toISOString().slice(0, 10)");
    expect(config).toMatch(/rev-parse --short=7 HEAD/);
    // Injectarea, nu forma ei: `define` a crescut de la o linie la un bloc cand
    // i s-a alaturat __APP_VERSION__, si un test care cere asezarea exacta se
    // rupe la fiecare reformatare fara sa apere nimic.
    expect(config).toMatch(/__BUILD_ID__:\s*JSON\.stringify\(buildId\(\)\)/);
  });

  /**
   * Versiunea afisata vine din package.json, nu scrisa de mana.
   *
   * Neconcordanta reala gasita pe telefon: Setarile aplicatiei aratau "2.0.0"
   * cat timp magazinul si build.gradle erau la 2.1.0 — adica exact cifra pe
   * care omul o copiaza intr-un raport de bug era gresita.
   */
  it('versiunea afisata vine din package.json', () => {
    expect(config).toMatch(/__APP_VERSION__:\s*JSON\.stringify\(pkg\.version\)/);

    const meniu = readFileSync(resolve(__dirname, 'ui/MenuDrawer.tsx'), 'utf8');
    expect(meniu).toContain('const APP_VERSION = __APP_VERSION__;');
    expect(meniu, 'versiune scrisa de mana in MenuDrawer').not.toMatch(/const APP_VERSION = '/);
  });

  it('vite.config.ts prefera GITHUB_SHA, care in CI e sursa oficiala', () => {
    // In CI directorul e un checkout unde `git` merge, dar variabila e cea
    // corecta — pe un merge commit, HEAD-ul local nu e commit-ul testat.
    expect(config).toContain('GITHUB_SHA');
    expect(config.indexOf('GITHUB_SHA')).toBeLessThan(config.indexOf('git rev-parse'));
  });

  it('lipsa lui git nu rupe build-ul', () => {
    // Fara `try`, un mediu fara git (sau un director fara .git) ar face
    // `vite build` sa arunce — adica marcajul de versiune ar putea impiedica
    // exact livrarea pe care e menit s-o faca verificabila.
    const zona = config.slice(config.indexOf('function buildId'), config.indexOf('export default'));
    expect(zona).toContain('try {');
    expect(zona).toContain('catch');
  });
});
