import * as Comlink from 'comlink';
import { db } from '../db';
import { readClipManifest, clipModelUrl, type ClipManifest, type ClipManifestRead } from './clipManifest';
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

let manifestPromise: Promise<ClipManifestRead> | null = null;

/**
 * Ce a iesit la citirea manifestului. Citit o singura data si tinut minte:
 * raspunsul nu se schimba cat timp pagina traieste.
 */
export function clipManifestState(): Promise<ClipManifestRead> {
  manifestPromise ??= readClipManifest();
  return manifestPromise;
}

/**
 * Variantele de model din build. Lista goala = functia nu exista — stare
 * normala, nu eroare. Cine are nevoie sa stie DE CE e goala (lipsa vs. manifest
 * necitibil) cheama clipManifestState.
 */
export async function clipAvailability(): Promise<ClipManifest[]> {
  const stare = await clipManifestState();
  return stare.kind === 'ok' ? stare.variants : [];
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
 * Ultimul motiv pentru care pornirea a esuat, in cuvintele runtime-ului.
 *
 * DE CE EXISTA, si e o corectie a unei greseli proprii: prima varianta inghitea
 * eroarea intr-un `catch {}` si arata "modelul nu a pornit pe acest dispozitiv".
 * Propozitia aia nu spune nimic — nici utilizatorului, nici mie. Cand functia a
 * picat pe telefonul real, singurul lucru pe care il stiam era ca a picat, iar
 * cauza (un fisier .wasm cerut la o adresa gresita) a trebuit gasita prin
 * reproducere locala, in loc sa fie citita de pe ecran.
 *
 * Pentru o functie al carei singur rost, deocamdata, e sa fie MASURATA, un mesaj
 * de esec fara cauza e o functie fara rost.
 */
export let lastClipError: string | null = null;

/**
 * Porneste workerul si incarca modelul. `null` cand nu exista model in build
 * sau cand pornirea esueaza — in ambele cazuri aplicatia merge exact ca acum.
 *
 * Idempotenta: al doilea apel primeste aceeasi sesiune, nu incarca modelul din
 * nou.
 */
export async function ensureClipReady(
  variant?: ClipManifest,
  forceBackend?: 'webgpu' | 'wasm'
): Promise<LiveWorker | null> {
  const dorit = variant ?? (await clipAvailability())[0];
  if (!dorit) return null;
  // Sesiunea se refoloseste doar daca e chiar aceeasi varianta pe acelasi
  // backend. Altfel ar raporta cifra unui model sub numele altuia — exact
  // genul de comparatie falsa pe care masuratoarea exista s-o previna.
  if (live && live.manifest.id === dorit.id && (!forceBackend || live.backend === forceBackend)) return live;
  releaseClip();
  lastClipError = null;
  try {
    // `new URL(..., import.meta.url)` e forma pe care Vite o recunoaste ca worker
    // si o imparte in chunk separat — vezi si workerPool.ts.
    const worker = new Worker(new URL('../../workers/clipEmbed.worker.ts', import.meta.url), { type: 'module' });
    const api = Comlink.wrap<ClipEmbedService>(worker);
    const res = await api.init(dorit, clipModelUrl(dorit), undefined, forceBackend);
    live = { worker, api, manifest: dorit, backend: res.backend, loadMs: res.loadMs };
    return live;
  } catch (err) {
    // Model corupt, wasm negasit, WebGPU si procesor amandoua refuzate, memorie
    // insuficienta — pentru aplicatie inseamna acelasi lucru (functia nu
    // porneste), dar pentru cine incearca s-o repare inseamna lucruri complet
    // diferite. De-aia motivul se pastreaza si se arata.
    lastClipError = err instanceof Error ? err.message : String(err);
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
export async function runClipBenchmark(
  photoIds: readonly string[],
  variant?: ClipManifest,
  forceBackend?: 'webgpu' | 'wasm'
): Promise<ClipBenchmarkResult | null> {
  const session = await ensureClipReady(variant, forceBackend);
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

/** Un rand din tabelul de comparatie: o varianta, pe un backend. */
export interface ClipMatrixRow {
  variant: ClipManifest;
  forced: 'webgpu' | 'wasm';
  result: ClipBenchmarkResult | null;
  /** Motivul, cand randul a picat. */
  error: string | null;
}

/**
 * Masoara FIECARE varianta pe FIECARE backend si intoarce tabelul.
 *
 * Exista fiindca prima masuratoare a dat 1404 ms pe poza si nimeni nu putea
 * spune de ce: modelul e prea greu, sau doar prost potrivit cu backend-ul pe
 * care a nimerit? Un singur numar nu raspunde niciodata la intrebarea asta —
 * un tabel de patru celule, da.
 *
 * Randurile picate raman IN tabel, cu motivul lor: "varianta X nu porneste pe
 * WebGPU" e un rezultat, nu o absenta.
 */
export async function runClipMatrix(
  photoIds: readonly string[],
  onProgress?: (facut: number, total: number) => void
): Promise<ClipMatrixRow[]> {
  const variants = await clipAvailability();
  const backends: ('webgpu' | 'wasm')[] = ['webgpu', 'wasm'];
  const randuri: ClipMatrixRow[] = [];
  const total = variants.length * backends.length;
  for (const variant of variants) {
    for (const forced of backends) {
      onProgress?.(randuri.length, total);
      const result = await runClipBenchmark(photoIds, variant, forced);
      randuri.push({ variant, forced, result, error: result ? null : lastClipError });
    }
  }
  onProgress?.(total, total);
  // Sesiunea ultimei combinatii n-are de ce sa ramana in memorie dupa un tabel.
  releaseClip();
  return randuri;
}
