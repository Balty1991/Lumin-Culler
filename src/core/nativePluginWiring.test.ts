/**
 * core/nativePluginWiring.test.ts
 *
 * Testul asta exista din cauza unui bug care a ajuns pe telefon si a fost
 * raportat de trei ori: bokeh-ul "nu detecteaza persoana". Partea de JS era
 * corecta, plugin-ul Kotlin era corect, si totusi nu se intampla nimic —
 * lipsea UN SINGUR rand din MainActivity.java, `registerPlugin(...)`. Fara el,
 * `Capacitor.isPluginAvailable('Segmentation')` intoarce false pe device, iar
 * codul cade tacut pe varianta de rezerva. Nimic nu esueaza, nimic nu se
 * logheaza — de-aia a supravietuit atatea build-uri verzi.
 *
 * Acelasi bug, a doua forma: plugin-ul e inregistrat, dar modelul lui .tflite/
 * .task nu e descarcat de workflow, deci nu ajunge in assets. MediaPipe arunca
 * abia la prima folosire, iar apelantii prind exceptia si trec mai departe.
 *
 * Sunt verificari de CABLAJ, nu de logica: se citesc fisierele reale si se
 * compara listele. Ruleaza in Node, deci pot citi android/ si .github/.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const PLUGINS_DIR = join(ROOT, 'android/app/src/main/java/com/luminculler/app/plugins');
const MAIN_ACTIVITY = join(ROOT, 'android/app/src/main/java/com/luminculler/app/MainActivity.java');
const BUILD_WORKFLOWS = ['.github/workflows/android-debug-build.yml', '.github/workflows/release-android.yml'];

/** Fisierele .ts din src/, recursiv — fara teste. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Numele plugin-urilor pe care le cheama codul: registerPlugin<...>('Nume'). */
function pluginsCalledFromJs(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/registerPlugin<[^>]*>\(\s*'([A-Za-z]+)'/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

describe('cablajul plugin-urilor native', () => {
  it('inregistreaza in MainActivity fiecare plugin pe care JS-ul il cheama', () => {
    const activity = readFileSync(MAIN_ACTIVITY, 'utf8');
    const neinregistrate = pluginsCalledFromJs().filter(
      name => !activity.includes(`registerPlugin(${name}Plugin.class);`)
    );
    expect(neinregistrate).toEqual([]);
  });

  it('importa in MainActivity fiecare plugin pe care il inregistreaza', () => {
    const activity = readFileSync(MAIN_ACTIVITY, 'utf8');
    const lipsa = [...activity.matchAll(/registerPlugin\((\w+)\.class\);/g)]
      .map(m => m[1])
      .filter(cls => !activity.includes(`import com.luminculler.app.plugins.${cls};`));
    expect(lipsa).toEqual([]);
  });

  it('descarca in build modelul fiecarui plugin inregistrat', () => {
    const activity = readFileSync(MAIN_ACTIVITY, 'utf8');
    const workflows = BUILD_WORKFLOWS.map(w => readFileSync(join(ROOT, w), 'utf8'));

    const lipsa: string[] = [];
    for (const file of readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.kt'))) {
      const cls = file.replace(/\.kt$/, '');
      // Un plugin neinregistrat n-are cum sa ceara modelul: nu ruleaza.
      if (!activity.includes(`registerPlugin(${cls}.class);`)) continue;
      const model = readFileSync(join(PLUGINS_DIR, file), 'utf8')
        .match(/MODEL_FILE\s*=\s*"([^"]+)"/)?.[1];
      if (!model) continue;
      BUILD_WORKFLOWS.forEach((name, i) => {
        // Fisierul trebuie sa apara ca DESTINATIE de curl, nu doar pomenit
        // intr-un comentariu — exact greseala pe care o prinde testul asta.
        if (!workflows[i].includes(`-o android/app/src/main/assets/${model}`)) {
          lipsa.push(`${cls} cere ${model}, dar ${name} nu il descarca`);
        }
      });
    }
    expect(lipsa).toEqual([]);
  });
});
