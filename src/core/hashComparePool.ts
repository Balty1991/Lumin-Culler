/**
 * core/hashComparePool.ts
 * Wrapper subtire peste hashCompare.worker.ts — un singur worker dedicat
 * (nu un pool de N, ca la analiza AI: gruparea e o singura trecere in bloc
 * la finalul importului, nu munca per-poza paralelizabila), creat lenes la
 * prima folosire si refolosit pentru toate importurile ulterioare din sesiune.
 */
import * as Comlink from 'comlink';
import type { HashCompareAPI, HashInput, GroupUpdate, GroupResult } from '../workers/hashCompare.worker';
import { withTimeout } from './workerPool';

let api: Comlink.Remote<HashCompareAPI> | null = null;
let worker: Worker | null = null;

function getApi(): Comlink.Remote<HashCompareAPI> {
  if (!api) {
    worker = new Worker(new URL('../workers/hashCompare.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<HashCompareAPI>(worker);
  }
  return api;
}

/** Buget generos, scalat cu marimea lotului — o singura trecere in bloc, nu per-poza. */
function groupTimeoutMs(count: number): number {
  return Math.max(60000, count * 50);
}

/**
 * workerPool.ts (analiza AI) are deja timeout + respawn pentru un worker blocat — acest
 * worker unic dedicat gruparii nu avea nimic echivalent. Bug real gasit de auditul QA: o
 * biblioteca cu un bucket patologic de mare (aproape de MAX_REFINEMENT_BUCKET_SIZE, cu
 * embeddinguri de fete voluminoase) putea bloca/OOM-a acest worker, iar `groupPhotos` fara
 * timeout ramanea agatat la nesfarsit pentru tot restul sesiunii — orice import ulterior s-ar
 * fi blocat la faza "grupare", fara nicio cale de recuperare din UI.
 */
export async function groupPhotosByHash(
  photos: HashInput[],
  onUpdate?: (update: GroupUpdate) => void
): Promise<{ groups: GroupResult[]; totalGroups: number }> {
  try {
    return await withTimeout(
      getApi().groupPhotos(photos, onUpdate ? Comlink.proxy(onUpdate) : undefined),
      groupTimeoutMs(photos.length),
      'Gruparea seriilor/duplicatelor a durat prea mult.'
    );
  } catch (err) {
    // Renuntam la worker-ul blocat si recream unul proaspat la urmatorul apel, in loc sa
    // ramanem agatati de instanta moarta pentru tot restul sesiunii.
    worker?.terminate();
    worker = null;
    api = null;
    throw err;
  }
}
