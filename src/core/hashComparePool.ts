/**
 * core/hashComparePool.ts
 * Wrapper subtire peste hashCompare.worker.ts — un singur worker dedicat
 * (nu un pool de N, ca la analiza AI: gruparea e o singura trecere in bloc
 * la finalul importului, nu munca per-poza paralelizabila), creat lenes la
 * prima folosire si refolosit pentru toate importurile ulterioare din sesiune.
 */
import * as Comlink from 'comlink';
import type { HashCompareAPI, HashInput, GroupUpdate, GroupResult } from '../workers/hashCompare.worker';

let api: Comlink.Remote<HashCompareAPI> | null = null;

function getApi(): Comlink.Remote<HashCompareAPI> {
  if (!api) {
    const worker = new Worker(new URL('../workers/hashCompare.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<HashCompareAPI>(worker);
  }
  return api;
}

export async function groupPhotosByHash(
  photos: HashInput[],
  onUpdate?: (update: GroupUpdate) => void
): Promise<{ groups: GroupResult[]; totalGroups: number }> {
  return getApi().groupPhotos(photos, onUpdate ? Comlink.proxy(onUpdate) : undefined);
}
