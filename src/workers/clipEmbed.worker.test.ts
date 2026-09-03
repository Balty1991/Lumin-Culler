import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ClipEmbedService, type OrtRuntime, type OrtSession } from './clipEmbed.worker';
import type { ClipManifest } from '../core/clip/clipManifest';

/**
 * workers/clipEmbed.worker.test.ts
 *
 * Runtime-ul ONNX real are nevoie de ~26 MB de wasm si de modelul propriu-zis,
 * care nu se comit in git — deci aici se testeaza CE FACE serviciul in jurul
 * inferentei, cu un runtime dublu. Adica exact partile in care poate gresi
 * codul nostru: cascada de backend, preprocesarea, si — cel mai important —
 * refuzul de a intoarce un vector in care nu putem avea incredere.
 */
const MANIFEST: ClipManifest = {
  id: 'test-model@v1', dim: 4, inputSize: 2,
  mean: [0, 0, 0], std: [1, 1, 1], file: 'model.onnx', bytes: 1000
};

/** Canvas minimal: jsdom n-are OffscreenCanvas, iar noi avem nevoie doar de pixeli previzibili. */
class StubOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(255)
      })
    };
  }
}

function stubRuntime(opts: {
  webgpuFails?: boolean;
  output?: Float32Array | number[] | undefined;
} = {}): OrtRuntime & { backendsTried: string[] } {
  const backendsTried: string[] = [];
  const session: OrtSession = {
    inputNames: ['pixel_values'],
    outputNames: ['image_embeds'],
    run: async () => ({ image_embeds: { data: opts.output ?? new Float32Array([1, 2, 3, 4]) } })
  };
  return {
    backendsTried,
    async createSession(_url, backend) {
      backendsTried.push(backend);
      if (backend === 'webgpu' && opts.webgpuFails) throw new Error('fara WebGPU pe telefonul asta');
      return session;
    },
    tensor: (data, dims) => ({ data, dims })
  };
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);
});

describe('init', () => {
  it('incearca WebGPU si raporteaza backend-ul chiar folosit', async () => {
    const runtime = stubRuntime();
    const rezultat = await new ClipEmbedService().init(MANIFEST, '/models/clip/model.onnx', runtime);
    expect(runtime.backendsTried).toEqual(['webgpu']);
    expect(rezultat.backend).toBe('webgpu');
    expect(rezultat.modelId).toBe('test-model@v1');
  });

  it('cade pe wasm cand WebGPU nu e disponibil, in loc sa ramana fara functie', async () => {
    // Telefon vechi, driver refuzat, browser fara WebGPU. wasm merge peste tot,
    // mai incet — iar un refugiu care merge bate o functie care nu porneste.
    const runtime = stubRuntime({ webgpuFails: true });
    const rezultat = await new ClipEmbedService().init(MANIFEST, '/m.onnx', runtime);
    expect(runtime.backendsTried).toEqual(['webgpu', 'wasm']);
    expect(rezultat.backend).toBe('wasm');
  });

  it('raporteaza cat a durat incarcarea — cifra, nu o promisiune', async () => {
    const rezultat = await new ClipEmbedService().init(MANIFEST, '/m.onnx', stubRuntime());
    expect(rezultat.loadMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(rezultat.loadMs)).toBe(true);
  });
});

describe('embed', () => {
  const bitmap = { width: 100, height: 60 } as ImageBitmap;

  it('fara init nu intoarce nimic — niciodata un vector inventat', async () => {
    expect(await new ClipEmbedService().embed(bitmap)).toBeNull();
  });

  it('intoarce vectorul impreuna cu identitatea modelului care l-a produs', async () => {
    // Vectorul si `modelId` nu se despart niciodata: fara el, nimeni nu mai
    // poate sti in ce spatiu traieste — vezi core/clip/clipVector.ts.
    const service = new ClipEmbedService();
    await service.init(MANIFEST, '/m.onnx', stubRuntime());
    const rezultat = await service.embed(bitmap);
    expect(rezultat?.modelId).toBe('test-model@v1');
    expect([...rezultat!.values]).toEqual([1, 2, 3, 4]);
  });

  it('REFUZA un vector de alta lungime decat spune manifestul', async () => {
    // Daca fisierul .onnx nu e cel descris de manifest, un vector de alta
    // dimensiune ar fi stocat vesel si comparat cu ceilalti pana cand cineva
    // ar observa, peste luni, ca "poze similare" nu mai gaseste nimic.
    const service = new ClipEmbedService();
    await service.init(MANIFEST, '/m.onnx', stubRuntime({ output: new Float32Array([1, 2]) }));
    expect(await service.embed(bitmap)).toBeNull();
  });

  it('nu se sperie daca runtime-ul da un tablou obisnuit in loc de Float32Array', async () => {
    const service = new ClipEmbedService();
    await service.init(MANIFEST, '/m.onnx', stubRuntime({ output: [5, 6, 7, 8] }));
    const rezultat = await service.embed(bitmap);
    expect(rezultat!.values).toBeInstanceOf(Float32Array);
    expect([...rezultat!.values]).toEqual([5, 6, 7, 8]);
  });

  it('intoarce null daca modelul nu raspunde nimic pe iesirea asteptata', async () => {
    const service = new ClipEmbedService();
    await service.init(MANIFEST, '/m.onnx', stubRuntime({ output: undefined }));
    // `output: undefined` cade pe valoarea implicita a dublului; verificam in
    // schimb calea in care iesirea chiar lipseste:
    const gol: OrtRuntime = {
      createSession: async () => ({
        inputNames: ['x'], outputNames: ['y'],
        run: async () => ({}) as Record<string, { data: Float32Array }>
      }),
      tensor: d => d
    };
    const alt = new ClipEmbedService();
    await alt.init(MANIFEST, '/m.onnx', gol);
    expect(await alt.embed(bitmap)).toBeNull();
  });

  it('masoara fiecare poza — asa se afla cat dureaza pe telefonul real', async () => {
    const service = new ClipEmbedService();
    await service.init(MANIFEST, '/m.onnx', stubRuntime());
    const rezultat = await service.embed(bitmap);
    expect(rezultat!.ms).toBeGreaterThanOrEqual(0);
  });
});
