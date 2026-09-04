/// <reference lib="webworker" />
/**
 * workers/clipEmbed.worker.ts
 * Vectorul CLIP al unei poze, calculat pe un thread separat.
 *
 * DE CE UN AL DOILEA WORKER, si nu in cel existent. faceAnalysis.worker.ts
 * ruleaza pe TensorFlow.js (prin Human) si e reglat fin — inclusiv o cascada de
 * backend-uri scrisa ca sa ocoleasca un blocaj real, observat pe un telefon
 * anume. CLIP ruleaza pe ONNX Runtime, un al doilea runtime complet. Puse in
 * acelasi worker, ar imparti `tf.env()` si contextul GPU, iar o problema a unuia
 * ar putea bloca importul intreg — adica exact functia care merge azi.
 * Separate, cel mai rau lucru care se poate intampla cu CLIP e ca CLIP nu merge.
 *
 * TOT CE E AICI E OPTIONAL. Runtime-ul ONNX (~26 MB de wasm) si modelul se aduc
 * abia dupa ce utilizatorul cere functia — de-aia importul lui `onnxruntime-web`
 * e DINAMIC, in interiorul lui init(). Un import static l-ar trage in pachetul
 * principal si l-ar plati toata lumea, inclusiv cine nu foloseste functia.
 *
 * MASURATOARE, nu promisiune: init() si embed() intorc si timpii, iar backend-ul
 * chiar folosit e raportat. Nu am putut masura modelul pe un telefon real din
 * mediul in care a fost scris codul asta, deci prima masuratoare adevarata se
 * face pe telefon, cu cifre venite de aici — nu cu estimari.
 */

import * as Comlink from 'comlink';
import { centerSquare, toTensor } from '../core/clip/clipPreprocess';
import type { ClipManifest } from '../core/clip/clipManifest';

/** Minimul din API-ul ONNX Runtime de care avem nevoie — ca testele sa poata da un dublu. */
export interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | number[] }>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

export interface OrtRuntime {
  createSession(modelUrl: string, backend: 'webgpu' | 'wasm'): Promise<OrtSession>;
  /** Impacheteaza un tensor float NCHW pentru `run`. */
  tensor(data: Float32Array, dims: readonly number[]): unknown;
}

export interface ClipInitResult {
  backend: 'webgpu' | 'wasm';
  /** Cat a durat aducerea runtime-ului si a modelului, in ms — cifra reala, de pe telefonul care o raporteaza. */
  loadMs: number;
  modelId: string;
  dim: number;
}

/**
 * Runtime-ul real. Importat dinamic ca sa nu intre in pachetul principal.
 *
 * `ort.env.wasm.wasmPaths` trebuie sa arate spre fisierele .wasm servite de
 * aplicatie: implicit, ONNX Runtime le cauta pe un CDN, ceea ce ar insemna ca o
 * aplicatie care se lauda ca nu trimite nimic in afara ar face o cerere catre un
 * server strain la prima analiza. Nu.
 */
async function loadRealRuntime(): Promise<OrtRuntime> {
  const ort = await import('onnxruntime-web/webgpu');
  /*
   * NU se atinge `ort.env.wasm.wasmPaths`, si e o lectie platita.
   *
   * Prima varianta il seta catre un director unde copiasem manual fisierul
   * .wasm. Motivul parea bun: implicit, ONNX Runtime si-l poate cere de pe un
   * CDN strain, ceea ce intr-o aplicatie care se lauda ca nu trimite nimic in
   * afara ar fi de neacceptat. Motivul era bun, solutia era gresita — si a rupt
   * exact functia pe care o pregatea.
   *
   * Doua lucruri pe care nu le stiam:
   *  - build-ul `onnxruntime-web/webgpu` cere `ort-wasm-simd-threaded.ASYNCIFY.wasm`,
   *    nu varianta `jsep` pe care o copiasem eu. Cererea se ducea intr-un 404,
   *    iar sesiunea nu pornea — pe telefon se vedea doar "modelul nu a pornit";
   *  - Vite REZOLVA deja singur fisierul: il emite in assets/ cu hash si
   *    rescrie referinta din pachetul ONNX catre el. Deci se serveste din
   *    aplicatie, local, fara niciun CDN — adica exact ce voiam — iar
   *    `wasmPaths` nu facea decat sa strice acea rezolvare corecta.
   *
   * Concluzia, pe scurt: aici lipsa unei linii e mai buna decat linia.
   */
  return {
    async createSession(modelUrl, backend) {
      return await ort.InferenceSession.create(modelUrl, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all'
      }) as unknown as OrtSession;
    },
    tensor: (data, dims) => new ort.Tensor('float32', data, dims as number[])
  };
}

export class ClipEmbedService {
  private session: OrtSession | null = null;
  private manifest: ClipManifest | null = null;
  private canvas: OffscreenCanvas | null = null;

  /**
   * Pregateste modelul. Intoarce si masuratorile, ca ecranul care a cerut
   * functia sa poata SPUNE cat a durat, in loc sa afirme ca "e rapid".
   *
   * Cascada e aceeasi idee ca la faceAnalysis: WebGPU intai, wasm ca refugiu.
   * Diferenta e ca aici esecul e ieftin — daca amandoua cad, functia lipseste,
   * si aplicatia e exact cea de azi.
   */
  async init(
    manifest: ClipManifest,
    modelUrl: string,
    runtime?: OrtRuntime,
    /**
     * Cand e dat, se foloseste EXACT acel backend, fara cascada. Exista pentru
     * masuratoare: un model cuantizat pe 8 biti poate fi mult mai rapid pe
     * procesor decat pe placa video (WebGPU nu-i cunoaste o parte din operatii
     * si le trimite inapoi pe CPU), iar asta nu se afla decat masurand
     * amandoua, nu lasand cascada sa aleaga.
     */
    forceBackend?: 'webgpu' | 'wasm'
  ): Promise<ClipInitResult> {
    const started = Date.now();
    const ort = runtime ?? await loadRealRuntime();
    let backend: 'webgpu' | 'wasm' = forceBackend ?? 'webgpu';
    try {
      this.session = await ort.createSession(modelUrl, backend);
    } catch (err) {
      // Placa video lipsa, driver refuzat, telefon vechi — wasm merge peste tot,
      // mai incet. Un refugiu care merge bate o functie care nu porneste.
      // Cand backend-ul a fost cerut explicit, esecul NU se ascunde: cine
      // masoara trebuie sa afle ca acel backend nu merge, nu sa primeasca
      // cifra altuia sub numele lui.
      if (forceBackend) throw err;
      backend = 'wasm';
      this.session = await ort.createSession(modelUrl, 'wasm');
    }
    this.manifest = manifest;
    this.runtime = ort;
    return { backend, loadMs: Date.now() - started, modelId: manifest.id, dim: manifest.dim };
  }

  private runtime: OrtRuntime | null = null;

  /**
   * Vectorul unei poze. `null` cand modelul nu e pregatit sau raspunde
   * altceva decat ne asteptam — niciodata un vector inventat.
   */
  async embed(bitmap: ImageBitmap): Promise<{ values: Float32Array; modelId: string; ms: number } | null> {
    const { session, manifest, runtime } = this;
    if (!session || !manifest || !runtime) return null;
    const started = Date.now();
    const size = manifest.inputSize;

    // Un singur canvas, reutilizat: alocarea unuia per poza ar face colectorul
    // de gunoi sa lucreze mai mult decat modelul, la mii de poze.
    this.canvas ??= new OffscreenCanvas(size, size);
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Decupare si scalare intr-un singur drawImage — vezi clipPreprocess.ts.
    const { sx, sy, size: src } = centerSquare(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, sx, sy, src, src, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const input = toTensor(data, size, manifest.mean, manifest.std);
    const feeds = { [session.inputNames[0]]: runtime.tensor(input, [1, 3, size, size]) };
    const out = await session.run(feeds);
    const raw = out[session.outputNames[0]]?.data;
    if (!raw) return null;
    const values = raw instanceof Float32Array ? raw : new Float32Array(raw);
    // Dimensiunea trebuie sa fie cea anuntata de manifest. Daca nu e, fisierul
    // de model nu e cel descris — iar un vector de alta lungime ar fi stocat
    // vesel si comparat cu ceilalti pana cand cineva ar observa ca "poze
    // similare" nu mai gaseste nimic.
    if (values.length !== manifest.dim) return null;
    return { values, modelId: manifest.id, ms: Date.now() - started };
  }

  /** Pentru ecranul de masurare: e pregatit sau nu. */
  isReady(): boolean {
    return this.session !== null;
  }
}

// Doar in worker adevarat: sub vitest fisierul e importat ca modul obisnuit,
// unde `Comlink.expose` n-ar avea pe ce sa se lege.
declare const self: DedicatedWorkerGlobalScope | undefined;
if (typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function') {
  Comlink.expose(new ClipEmbedService());
}
