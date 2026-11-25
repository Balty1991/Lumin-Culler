/**
 * lumin/nativeSelfTest.ts
 * Doar în build-ul de test: modelele native rulate direct pe pozele trimise către
 * aplicație, cu rezultatul în logcat. Testul de pe emulator (scripts/smoke-start.sh)
 * îl citește. Fără el, pozele trimise treceau doar prin importul ușor, iar MediaPipe
 * și ML Kit nu erau atinse deloc: căderea R8 de la fețe (Flogger) și etichetele
 * greșite de animale s-au văzut abia pe telefon.
 */
import { nativeMark } from '../core/device';
import { analyzeFaceMeshNative } from '../core/nativeFaceMesh';
import { labelImageNative } from '../core/nativeImageLabeling';
import { detectPoseNative } from '../core/nativePoseDetection';
import { segmentSubjectNative } from '../core/nativeSegmentation';

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 160);

export async function runNativeSelfTest(paths: readonly string[], files: readonly File[]): Promise<void> {
  for (let i = 0; i < paths.length; i++) {
    const uri = /^[a-z]+:\/\//.test(paths[i]) ? paths[i] : `file://${paths[i]}`;
    const parts: string[] = [];
    let failed = false;
    const step = async (name: string, fn: () => Promise<string>) => {
      try { parts.push(`${name}=${await fn()}`); } catch (e) { failed = true; nativeMark(`selftest error ${i} ${name}: ${short(e)}`); }
    };
    await step('faces', async () => String((await analyzeFaceMeshNative({ uri, maxSide: 960 })).faces.length));
    await step('labels', async () => (await labelImageNative({ uri, maxSide: 480 })).labels.map(l => l.label).join('|') || '-');
    await step('pose', async () => String((await detectPoseNative({ uri, maxSide: 640 })).people.length));
    if (files[i]) await step('seg', async () => (await segmentSubjectNative(files[i])).personCoverage.toFixed(2));
    nativeMark(`selftest ${failed ? 'partial' : 'ok'} ${i} ${parts.join(' ')}`);
  }
  nativeMark('selftest done');
}
