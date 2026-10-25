import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * src/androidModels.test.ts
 * Ce modele Human.js intra in APK: niciunul. PWA-ul le pastreaza pe toate sase.
 *
 * A doua jumatate a lui e5 din auditul motoarelor: pe Android, analiza normala
 * nu atinge deloc Human.js (ruleaza pe plugin-urile native), iar singurele doua
 * locuri in care el chiar ruleaza pe telefon — inrolarea si recunoasterea per
 * fata — pornesc pe configuratii SLABE, cu mesh/iris/emotie/CenterNet
 * dezactivate. Cele patru modele intrau in fiecare instalare, 8,9 MB, ca sa nu
 * fie citite niciodata.
 *
 * Testul asta nu masoara marimea APK-ului; apara LANTUL de motive care face
 * excluderea sigura. Rupe-l intr-un capat, si celalalt devine un 404 pe telefon,
 * fara nicio eroare la compilare:
 *
 *  - daca cineva porneste un worker Human.js COMPLET pe Android, are nevoie de
 *    modelele care nu mai sunt acolo;
 *  - daca cineva scoate `leanMode` de la inrolare sau recunoastere, la fel;
 *  - daca cineva "repara" workflow-urile Android copiind iar toate sase,
 *    economia dispare in tacere.
 */
const rad = resolve(__dirname, '..');
const citeste = (cale: string) => readFileSync(resolve(rad, cale), 'utf8');

const MODELE_GRELE = ['facemesh', 'iris', 'emotion', 'centernet'];

describe('modelele Human.js din pachetul Android', () => {
  it('APK-ul de test copiază doar blazeface și faceres', () => {
    const workflow = citeste('.github/workflows/android-debug-build.yml');
    expect(workflow).toContain('for m in blazeface faceres; do');
    expect(workflow).toContain('VITE_TEST_IDENTITY=1');
    for (const model of MODELE_GRELE) {
      expect(workflow, `${model} nu intra în APK-ul de test`).not.toMatch(new RegExp(`for m in .*${model}`));
    }
  });

  it('release-ul nu copiază niciun model Human.js', () => {
    const workflow = citeste('.github/workflows/release-android.yml');
    expect(workflow).toContain('Human.js nu mai intra in APK');
    expect(workflow).not.toContain('for m in blazeface faceres');
    expect(workflow).not.toContain('VITE_TEST_IDENTITY');
    for (const model of ['blazeface', 'faceres', ...MODELE_GRELE]) {
      expect(workflow, `${model} nu mai are ce cauta in release`).not.toMatch(new RegExp(`for m in .*${model}`));
    }
  });

  /**
   * PWA-ul le pastreaza pe toate sase: acolo Human.js chiar face analiza
   * completa. Cele doua liste TREBUIE sa ramana diferite — daca cineva le
   * uniformizeaza "ca sa fie la fel", una dintre ele se strica.
   */
  it('PWA-ul le pastreaza pe toate sase — acolo Human.js face analiza intreaga', () => {
    const deploy = citeste('.github/workflows/deploy.yml');
    expect(deploy).toContain('for m in blazeface facemesh iris emotion faceres centernet; do');
  });
});

describe('de ce e sigura excluderea', () => {
  it('pe Android nu porneste niciun worker Human.js complet', () => {
    const pool = citeste('src/core/workerPool.ts');
    // init() se intoarce inainte de `this.slots = []` cand platforma e nativa.
    const init = pool.slice(pool.indexOf('async init()'));
    const gard = init.indexOf('Capacitor.isNativePlatform()');
    const primulSlot = init.indexOf('this.slots = []');
    expect(gard, 'gardul pentru platforma nativa a disparut din init()').toBeGreaterThan(-1);
    expect(gard).toBeLessThan(primulSlot);
  });

  it('inrolarea si recunoasterea cer amandoua o configuratie slaba', () => {
    const pool = citeste('src/core/workerPool.ts');
    expect(pool).toContain("this.spawnSlot(undefined, 'enrollment')");
    expect(pool).toContain("this.spawnSlot(undefined, 'recognition')");
  });

  /**
   * Bug real, scos la iveala chiar de excludere: `respawnSlot` cerea mereu
   * configuratia COMPLETA. Un singur timeout la inrolare inlocuia worker-ul slab
   * cu unul care incearca sa incarce mesh/iris/emotie/CenterNet — modele care
   * nu mai sunt in APK. Adica o inrolare care intarzie o data ramanea stricata
   * pentru tot restul sesiunii, cu un 404 in loc de o eroare limpede.
   */
  it('un worker repornit dupa timeout pastreaza configuratia cu care a fost pornit', () => {
    const pool = citeste('src/core/workerPool.ts');
    // Doar corpul lui respawnSlot: pe calea web, `resizeForEconomicMode` cheama
    // legitim spawnSlot fara mod slab, si n-are de ce sa pice testul asta.
    const corp = pool.slice(pool.indexOf('private async respawnSlot('));
    expect(corp.slice(0, corp.indexOf('\n  }'))).toContain('this.spawnSlot(this.detectedBackend, slot.leanMode)');
  });

  it('modul slab chiar dezactiveaza cele patru modele care nu mai sunt in pachet', () => {
    const worker = citeste('src/workers/faceAnalysis.worker.ts');
    const slabe = worker.slice(worker.indexOf("leanMode === 'recognition'"));
    for (const bucata of ['mesh: { enabled: false }', 'iris: { enabled: false }', 'emotion: { enabled: false }']) {
      expect(slabe, `${bucata} lipseste din configuratiile slabe`).toContain(bucata);
    }
    // CenterNet e `object` in configuratia Human.
    expect(slabe).toContain('object: { ...HUMAN_CONFIG.object, enabled: false }');
  });
});
