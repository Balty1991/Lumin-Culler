/**
 * core/skySegment.ts
 * Unde e cerul și unde sunt oamenii, cu un model de segmentare (SegFormer-b0, ADE20K,
 * cuantizat, ~4,4 MB), rulat local cu onnxruntime-web — în browser și în aplicație.
 * Înainte cerul se ghicea din culori: intra în gluga albă și lăsa pete albe între
 * crengi (raportat cu capturi). Clasele ADE20K: 2 = cer, 12 = persoană.
 * Verificat în CI: intrare pixel_values [1,3,512,512] (ImageNet), ieșire logits [1,150,128,128].
 */
import type { InferenceSession } from 'onnxruntime-web';
import { onDeviceEditAvailable, segmentOnDevice } from './onDeviceEdit';

const MODEL_URL = `${import.meta.env.BASE_URL}models/segformer_ade_q.onnx`;
const SIDE = 512;
const SKY = 2, PERSON = 12;

let session: Promise<InferenceSession | null> | null = null;

function load(): Promise<InferenceSession | null> {
  session ??= (async () => {
    try {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    } catch {
      session = null;
      return null;
    }
  })();
  return session;
}

export interface SkySegmentation {
  /** Probabilitatea de cer (0..1), grilă `size`×`size` peste toată poza. */
  sky: Float32Array;
  /** Probabilitatea de persoană (0..1), aceeași grilă. */
  person: Float32Array;
  size: number;
}

export async function segmentSky(source: CanvasImageSource): Promise<SkySegmentation | null> {
  // În aplicație: modelul rulează nativ (onnxruntime-android), fără runtime-ul web de 14 MB în APK.
  if ((await onDeviceEditAvailable()).sky) {
    const c = document.createElement('canvas');
    c.width = SIDE; c.height = SIDE;
    c.getContext('2d')?.drawImage(source, 0, 0, SIDE, SIDE);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.92));
    const native = blob ? await segmentOnDevice(blob) : null;
    if (native) return native;
  }
  const s = await load();
  if (!s) return null;
  const ort = await import('onnxruntime-web/wasm');
  const c = document.createElement('canvas');
  c.width = SIDE; c.height = SIDE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, SIDE, SIDE);
  const px = ctx.getImageData(0, 0, SIDE, SIDE).data;
  const n = SIDE * SIDE;
  const x = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, SIDE, SIDE]) });
  const t = out[s.outputNames[0]];
  const [, classes, gh, gw] = t.dims as number[];
  const logits = t.data as Float32Array;
  const m = gh * gw;
  const sky = new Float32Array(m), person = new Float32Array(m);
  for (let p = 0; p < m; p++) {
    let max = -Infinity;
    for (let k = 0; k < classes; k++) { const v = logits[k * m + p]; if (v > max) max = v; }
    let sum = 0;
    for (let k = 0; k < classes; k++) sum += Math.exp(logits[k * m + p] - max);
    sky[p] = Math.exp(logits[SKY * m + p] - max) / sum;
    person[p] = Math.exp(logits[PERSON * m + p] - max) / sum;
  }
  return { sky, person, size: gw };
}
