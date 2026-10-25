import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * src/androidModels.test.ts
 * Pachetul cleaner nu mai copiaza modelele Human.js, CLIP sau lista de orase.
 * Vite pune tot `public/` in dist, iar Capacitor pune dist in APK. Un `for m in`
 * reintrodus aici umfla iar instalarea, fara niciun ecran care sa citeasca
 * fisierele.
 *
 * Modulul de fotograf (worker-ul Human.js) ramane in repo. Testele de mai jos
 * pazesc configuratia slaba, ca o reactivare sa nu ceara mesh/iris/emotie
 * fara sa le aduca inapoi explicit.
 */
const rad = resolve(__dirname, '..');
const citeste = (cale: string) => readFileSync(resolve(rad, cale), 'utf8');

const MODELE = ['blazeface', 'facemesh', 'iris', 'emotion', 'faceres', 'centernet'];

describe('modelele Human.js nu intra in pachetul cleaner', () => {
  it.each([
    '.github/workflows/android-debug-build.yml',
    '.github/workflows/release-android.yml',
    '.github/workflows/deploy.yml'
  ])('%s nu copiaza modele Human.js si nu descarca orasele', cale => {
    const workflow = citeste(cale);
    expect(workflow).not.toMatch(/for m in [^\n]*blazeface/);
    expect(workflow).not.toContain('cities500.zip');
    expect(workflow).not.toContain('face_landmarker.task');
    expect(workflow).not.toContain('fetch-clip-model');
    for (const model of MODELE) {
      expect(workflow, `${model} nu are ce cauta in pachet`).not.toContain(`human/models/${model}`);
    }
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
