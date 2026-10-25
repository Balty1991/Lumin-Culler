/**
 * core/twoStagePlan.ts
 * Cine merită modelele grele, după ce toată galeria are deja o amprentă ieftină.
 *
 * O poză singură (nicio vecină sub pragul de rafală) nu schimbă „cel mai bun
 * cadru”: nu are cu cine să fie comparată. Detecția de fețe, etichetele, OCR-ul
 * și poziția corpului rulează doar pe membrii unei serii — și pe o poză nouă
 * care continuă o serie deja aflată în bibliotecă.
 */
import { hamming64 } from './dhash';

/**
 * Sub atâția biți diferiți, două cadre sunt aceeași rafală sau aproape.
 *
 * Pragul de moment din hashCompare.worker.ts (26) e mai larg: el leagă și
 * cadre mișcate, după ce analiza a rulat. Aici alegem doar cine PLĂTEȘTE
 * analiza. 12 biți din 64 prinde duplicatele și rafalele strânse, nu două
 * poze care doar seamănă vag.
 */
export const SERIES_CANDIDATE_HAMMING = 12;

export interface HashRef {
  id: string;
  /** Șir dHash. Gol = nu s-a putut calcula; poza merge pe calea grea, ca să nu pierdem un cadru. */
  hash: string;
}

export function candidateIds(
  fresh: readonly HashRef[],
  existingHashes: readonly string[] = [],
  maxHamming: number = SERIES_CANDIDATE_HAMMING
): Set<string> {
  const out = new Set<string>();
  const usable = fresh.filter(item => item.hash.length > 0);
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (hamming64(usable[i].hash, usable[j].hash) <= maxHamming) {
        out.add(usable[i].id);
        out.add(usable[j].id);
      }
    }
  }
  if (existingHashes.length > 0) {
    for (const item of usable) {
      if (out.has(item.id)) continue;
      for (const prev of existingHashes) {
        if (prev && hamming64(item.hash, prev) <= maxHamming) {
          out.add(item.id);
          break;
        }
      }
    }
  }
  for (const item of fresh) {
    if (!item.hash) out.add(item.id);
  }
  return out;
}

export interface CacheIdentity {
  key: string;
  size: number;
  mtime: number;
}

/** Cheia unei poze pentru rescanare: același fișier, nemodificat, nu se redecodifică. */
export function stageOneKey(parts: { uri?: string; name: string; size: number; mtime: number }): string {
  return `${parts.uri ?? parts.name}\n${parts.size}\n${parts.mtime}`;
}

/**
 * Rescanare incrementală. `reuse` a fost deja amprentat (aceeași mărime și
 * aceeași dată). `refresh` e nou sau s-a schimbat pe disc.
 */
export function incrementalStageOne(
  cached: readonly CacheIdentity[],
  incoming: readonly CacheIdentity[]
): { reuse: string[]; refresh: string[] } {
  const byKey = new Map(cached.map(item => [item.key, item]));
  const reuse: string[] = [];
  const refresh: string[] = [];
  for (const item of incoming) {
    const prev = byKey.get(item.key);
    if (prev && prev.size === item.size && prev.mtime === item.mtime) reuse.push(item.key);
    else refresh.push(item.key);
  }
  return { reuse, refresh };
}
