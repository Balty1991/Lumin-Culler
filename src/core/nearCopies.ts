import { hamming64 } from './dhash';
import type { DuplicateCandidate } from './exactDuplicates';

/**
 * core/nearCopies.ts
 * Copiile „aproape la fel”: aceeași poză primită sau trimisă pe WhatsApp
 * (Messenger, Telegram), recomprimată, deci cu alt număr de octeți — copiile
 * identice (core/exactDuplicates.ts) nu le prind.
 *
 * Ca să nu confunde o rafală (două cadre aproape la fel, ambele reale) cu o
 * copie, se cere ca măcar una dintre poze să fie fișierul unei aplicații de
 * mesaje (numele „IMG-20240512-WA0007.jpg”, „…telegram…” etc.) și ca
 * amprentele vizuale să fie aproape identice (cel mult 3 biți din 64).
 * Rămâne cea mai mare (originalul, necomprimat); pleacă copiile mici.
 */
const MAX_BITS = 3;
const CHAT = /(-WA\d{3,}|whatsapp|telegram|messenger|signal-|viber)/i;

export function isChatCopyName(name: string): boolean {
  return CHAT.test(name);
}

export interface NearCopySet { keepId: string; copyIds: string[]; wastedBytes: number }

export function findNearCopies(items: readonly DuplicateCandidate[]): NearCopySet[] {
  const usable = items.filter(p => p.dHash && p.dHash.length >= 64 && (p.sizeBytes ?? 0) > 0);
  // Porumbei: la cel mult 3 biți diferiți, măcar unul din cele 4 sferturi e identic.
  const index = new Map<string, number[]>();
  usable.forEach((p, i) => {
    for (let q = 0; q < 4; q++) {
      const key = `${q}:${p.dHash.slice(q * 16, q * 16 + 16)}`;
      const list = index.get(key);
      if (list) list.push(i); else index.set(key, [i]);
    }
  });
  // Uniune-căutare pe perechile apropiate în care măcar una vine din mesaje.
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const list of index.values()) {
    if (list.length < 2 || list.length > 400) continue; // un sfert banal (cer gol) nu spune nimic
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const pa = usable[list[a]], pb = usable[list[b]];
      if (!isChatCopyName(pa.fileName) && !isChatCopyName(pb.fileName)) continue;
      if (pa.sizeBytes === pb.sizeBytes) continue; // identice: le ia exactDuplicates
      if (hamming64(pa.dHash, pb.dHash) > MAX_BITS) continue;
      parent[find(list[a])] = find(list[b]);
    }
  }
  const groups = new Map<number, DuplicateCandidate[]>();
  usable.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p); else groups.set(r, [p]);
  });
  const sets: NearCopySet[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // Păstrăm: o poză păstrată de om, altfel cea mai mare (cea mai puțin comprimată).
    const keep = g.find(p => p.status === 'selected') ?? [...g].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || a.id.localeCompare(b.id))[0];
    const copies = g.filter(p => p.id !== keep.id && p.status !== 'selected');
    if (!copies.length) continue;
    sets.push({ keepId: keep.id, copyIds: copies.map(p => p.id).sort(), wastedBytes: copies.reduce((s, p) => s + (p.sizeBytes ?? 0), 0) });
  }
  return sets.sort((a, b) => b.wastedBytes - a.wastedBytes || a.keepId.localeCompare(b.keepId));
}
