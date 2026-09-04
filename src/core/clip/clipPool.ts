import * as Comlink from 'comlink';
import { db } from '../db';
import { readClipManifest, clipModelUrl, type ClipManifest } from './clipManifest';
import { summarizeBenchmark, BENCHMARK_SAMPLES, type ClipBenchmarkResult } from './clipBenchmark';
import type { ClipEmbedService } from '../../workers/clipEmbed.worker';

/**
 * core/clip/clipPool.ts
 * Puntea dintre aplicatie si workerul CLIP — si singurul loc care il porneste.
 *
 * TOT CE E AICI E LENES, si asta e proiectarea, nu o optimizare. Nimic nu se
 * incarca la pornirea aplicatiei: nici workerul, nici runtime-ul ONNX (~28 MB
 * de wasm), nici modelul (~11 MB). Se aduc abia cand cineva chiar cere sa
 * masoare sau sa foloseasca functia. Cine n-o cere nu plateste niciun octet —
 * build-ul o confirma: pachetul principal a crescut cu 0,3 kB, nu cu 39 MB.
 *
 * UN SINGUR WORKER, spre deosebire de pool-ul de analiza (core/workerPool.ts,
 * unul per nucleu). Aici nu e nimic de castigat din paralelism: ONNX Runtime
 * pe WebGPU foloseste oricum placa video, iar doua sesiuni ar concura pe
 * acelasi GPU si ar dubla memoria pentru acelasi debit. Iar daca ajungem pe
 * wasm, mai multi workeri pe un telefon ieftin inseamna doar mai multa
 * presiune de RAM.
 */

/** Ce stie aplicatia despre motorul nou, fara sa-l porneasca. */
export interface ClipAvailability {
  /** null = build-ul asta n-are model, deci functia nu exista. Nu e o eroare. */
  manifest: ClipManifest | null;
}

let manifestPromise: Promise<ClipManifest | null> | null = null;

/**
 * Exista un model in build-ul asta? Citit o singura data si tinut minte:
 * raspunsul nu se schimba cat timp pagina traieste.
 */
export function clipAvailability(): Promise<ClipManifest | null> {
  manifestPromise ??= readClipManifest();
  return manifestPromise;
}

interface LiveWorker {
  worker: Worker;
  api: Comlink.Remote<ClipEmbedService>;
  manifest: ClipManifest;
  backend: 'webgpu' | 'wasm';
  loadMs: number;
}

let live: LiveWorker | null = null;

/**
 * Porneste workerul si incarca modelul. `null` cand nu exista model in build
 * sau cand pornirea esueaza — in ambele cazuri aplicatia merge exact ca acum.
 *
 * Idempotenta: al doilea apel primeste aceeasi sesiune, nu incarca modelul din
 * nou.
 */
export async function ensureClipReady(): Promise<LiveWorker | null> {
  if (live) return live;
  const manifest = await clipAvailability();
  if (!manifest) return null;
  try {
    // `new URL(..., import.meta.url)` e forma pe care Vite o recunoaste ca worker
    // si o imparte in chunk separat — vezi si workerPool.ts.
    const worker = new Worker(new URL('../../workers/clipEmbed.worker.ts', import.meta.url), { type: 'module' });
    const api = Comlink.wrap<ClipEmbedService>(worker);
    const res = await api.init(manifest, clipModelUrl(manifest));
    live = { worker, api, manifest, backend: res.backend, loadMs: res.loadMs };
    return live;
  } catch {
    // Model corupt, WebGPU si wasm amandoua refuzate, memorie insuficienta —
    // toate inseamna acelasi lucru pentru utilizator: functia nu porneste.
    return null;
  }
}

/** Opreste workerul si elibereaza memoria modelului. Dupa oprirea functiei din setari. */
export function releaseClip(): void {
  live?.worker.terminate();
  live = null;
}

/**
 * Masoara motorul pe TELEFONUL DE FATA, pe pozele UTILIZATORULUI.
 *
 * De ce pe pozele lui si nu pe o imagine de test: o poza generata sintetic
 * masoara acelasi numar de operatii, dar nu si costul real de decodare al unui
 * JPEG de telefon. Iar cifra asta trebuie sa fie una in care sa poti avea
 * incredere cand hotarasti daca pornesti functia.
 *
 * Vectorii calculati aici NU se salveaza. E o masuratoare, nu o analiza: daca
 * omul decide sa nu porneasca functia, n-are de ce sa ramana cu date de la ea
 * pe telefon.
 */
export async function runClipBenchmark(photoIds: readonly string[]): Promise<ClipBenchmarkResult | null> {
  const session = await ensureClipReady();
  if (!session) return null;
  const perPhoto: number[] = [];
  for (const id of photoIds.slice(0, BENCHMARK_SAMPLES)) {
    const rec = await db.previews.get(id);
    if (!rec) continue;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(rec.blob);
    } catch {
      continue; // poza nedecodabila — sare, nu opreste masuratoarea
    }
    try {
      const out = await session.api.embed(Comlink.transfer(bitmap, [bitmap]));
      if (out) perPhoto.push(out.ms);
    } finally {
      // `transfer` muta bitmap-ul in worker, deci aici e deja neutralizat;
      // close() ramane corect si pe calea in care transferul n-a avut loc.
      try { bitmap.close(); } catch { /* deja transferat */ }
    }
  }
  return summarizeBenchmark(session.backend, session.loadMs, perPhoto);
}
