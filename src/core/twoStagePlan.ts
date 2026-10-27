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
 * analiza. 14 biți din 64 e același prag ca nivelul vizual al grupării:
 * altfel o poză putea ajunge în serie la final fără să fi fost analizată ca
 * membru de serie.
 */
export const SERIES_CANDIDATE_HAMMING = 14;

/** Rafală făcută din mână: cadrul se mută mai mult, dar pozele sunt la secunde distanță. */
export const BURST_CANDIDATE_HAMMING = 24;
export const BURST_CANDIDATE_WINDOW_MS = 45_000;

/** Aceleași două praguri ca primele două niveluri din hashCompare.worker.ts. */
export function isSeriesCandidate(hamming: number, msApart: number | undefined): boolean {
  if (hamming <= SERIES_CANDIDATE_HAMMING) return true;
  return msApart !== undefined && hamming <= BURST_CANDIDATE_HAMMING && msApart <= BURST_CANDIDATE_WINDOW_MS;
}

/** IMG_20261024_081609, PXL_20261024_081609123, Screenshot_2026-10-24-08-16-09 ... */
const NAME_TIME = /(20\d{2})-?(\d{2})-?(\d{2})[_ -]?(\d{2})[-.]?(\d{2})[-.]?(\d{2})/;

/**
 * Când a fost făcută poza, cât se poate afla înainte de EXIF.
 *
 * Pozele alese din galerie ajung ca File creat chiar atunci, deci
 * `lastModified` e momentul importului, același pentru toate. Luat drept oră
 * a pozei, făcea din tot lotul o „rafală” și trimitea aproape fiecare poză la
 * analiza grea (raportat: 136 din 138). O dată de după începutul importului
 * nu e a pozei; atunci se citește din nume, iar fără nume datat nu se știe.
 */
export function stageOneTime(file: { name: string; lastModified: number }, importStartedAt: number): number | undefined {
  if (file.lastModified > 0 && file.lastModified < importStartedAt - 120_000) return file.lastModified;
  const m = NAME_TIME.exec(file.name);
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return undefined;
  return new Date(y, mo - 1, d, h, mi, se).getTime();
}

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
