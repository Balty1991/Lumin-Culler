/**
 * lumin/assistantBrain.ts
 * „Întreabă-ți galeria”: înțelege ce cere omul și răspunde din ce știe deja
 * aplicația (căutarea pe cuvinte, oamenii, datele, seriile). Rulează pe telefon,
 * fără server: reguli simple pentru intenții, apoi căutarea obișnuită.
 */
import { bestForReel, reelPicks } from './reelPicks';
import { applyFilters, fixNames, parseQuery, type ParsedQuery } from './assistantQuery';
import type { PhotoView } from '../state/store';
import { fold, searchPhotos } from './textSearch';
import { photoTime } from './days';

export type AssistantReply =
  | { kind: 'results'; query: string; photos: PhotoView[]; best: boolean; filters?: ParsedQuery; /** Găsite doar cu o parte din cuvinte. */ approx?: boolean }
  | { kind: 'none'; query: string; /** Ce s-a putut găsi doar cu o parte din cuvinte: arătat abia după căutarea CLIP. */ partial?: PhotoView[]; filters?: ParsedQuery }
  | { kind: 'stats'; total: number; kept: number; waiting: number; extras: number; people: number }
  | { kind: 'cleanup'; photos: PhotoView[]; sets: number; screenshots: number }
  | { kind: 'waiting'; photos: PhotoView[] }
  | { kind: 'train' }
  | { kind: 'studio' }
  | { kind: 'add' }
  | { kind: 'year'; year: number }
  | { kind: 'reel'; query: string; ids: string[] };

/** Cuvinte de umplutură din întrebări: nu se caută. */
const FILLER = new Set(('arata arati mi imi vreau sa vad vezi gaseste cauta da poze pozele poza fotografii fotografiile cu de la din pe in si unde e este sunt toate ale lui ei cele mai ' +
  'show me find search photos photo pictures picture of with the from in on my all and where is are please te rog').split(' '));

const has = (q: string, re: RegExp) => re.test(q);

function seriesExtras(photos: readonly PhotoView[]): { sets: number; extras: PhotoView[] } {
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId || p.aside) continue;
    const g = groups.get(p.groupId);
    if (g) g.push(p); else groups.set(p.groupId, [p]);
  }
  let sets = 0;
  const extras: PhotoView[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const best = g.find(p => p.status === 'selected') ?? [...g].sort((a, b) => b.aiScore - a.aiScore)[0];
    const rest = g.filter(p => p !== best && p.status !== 'selected' && p.mediaUri);
    if (rest.length) { sets++; extras.push(...rest); }
  }
  return { sets, extras };
}

const isWaiting = (p: PhotoView) => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate');

export function answer(input: string, photos: readonly PhotoView[], now = Date.now()): AssistantReply {
  const q = fold(input).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (has(q, /\b(anul meu|rezumatul anului|my year|year in review|wrapped)\b/) || /^(anul (asta|acesta)|this year)$/.test(q)) return { kind: 'year', year: new Date(now).getFullYear() };
  if (has(q, /\b(adauga|importa|incarca|add|import|upload)\b/)) return { kind: 'add' };
  if (has(q, /\b(antrene|invata|train|teach|gustul)\w*/)) return { kind: 'train' };
  if (has(q, /\b(cate|cati|statistic|how many|stats|numar)\w*/)) {
    const names = new Set<string>();
    for (const p of photos) for (const n of p.personNames ?? []) names.add(n);
    return { kind: 'stats', total: photos.length, kept: photos.filter(p => p.status === 'selected').length, waiting: photos.filter(isWaiting).length, extras: seriesExtras(photos).extras.length, people: names.size };
  }
  if (has(q, /\b(curat|sterge|duplicat|dubluri|serii|spatiu|elibere|clean|delete|duplicate|bursts?|free up|space)\w*/)) {
    const s = seriesExtras(photos);
    const old = now - 30 * 86_400_000;
    return { kind: 'cleanup', photos: s.extras, sets: s.sets, screenshots: photos.filter(p => p.aside === 'screenshot' && photoTime(p) < old).length };
  }
  if (has(q, /\b(astept|asteapt|nesortat|de vazut|sorteaz|waiting|unsorted|to review|sort)\w*/)) return { kind: 'waiting', photos: photos.filter(isWaiting) };
  // „Fă un Reel cu Ami din vacanță”: caută pozele, apoi le face Reel (nu doar deschide Studio).
  if (has(q, /\b(reel|reels|tiktok|filmulet|film|video|clip|movie)\w*/)) {
    const subject = q.replace(/\b(fa|faci|fami|fa mi|creeaza|creaza|vreau|un|o|niste|mi|imi|make|me|a|reels?|tiktok|filmulet\w*|film\w*|video\w*|clip\w*|movie|din|cu|with|from|of)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!subject) return { kind: 'reel', query: '', ids: reelPicks(photos, 12, now) };
    const inner = answer(subject, photos, now);
    if (inner.kind === 'results') return { kind: 'reel', query: subject, ids: bestForReel(inner.photos) };
    return { kind: 'reel', query: subject, ids: [] };
  }
  if (has(q, /\b(colaj|collage|studio)\w*/)) return { kind: 'studio' };

  const best = has(q, /\b(cele mai|cea mai|best|top|frumoas|reusit|beautiful)\w*/);
  // Când, care, câte, cine (vezi assistantQuery.ts): „pozele păstrate de ieri cu Amy”.
  const pq = parseQuery(input, now);
  const names = [...new Set(photos.flatMap(p => p.personNames ?? []))];
  const rest = fixNames(pq.rest, names);
  const terms = rest.split(' ').filter(w => w.length > 1 && !FILLER.has(w) && !/^(bune|buna|frumoase|frumoasa|reusite|best|top|beautiful)$/.test(w));
  const filtered = !!(pq.from !== undefined || pq.status || pq.quality);
  const pool = applyFilters(photos.filter(p => !p.aside || /bon|document|captur|screenshot|receipt/.test(q)), pq);
  let found = terms.length ? searchPhotos(pool, terms.join(' ')) : [];
  if (!terms.length && (best || filtered || pq.limit)) found = best && !filtered ? pool.filter(p => p.status === 'selected') : [...pool];
  if (!found.length) {
    // Nimic cu toate cuvintele: întâi căutarea CLIP (în Assistant.tsx), abia apoi ce se
    // găsește cu o parte din cuvinte — altfel „geacă roșie” devenea „geacă” și aducea orice geacă.
    let partial: PhotoView[] = [];
    if (terms.length > 1) {
      for (const t of [...terms].sort((a, b) => b.length - a.length)) { partial = searchPhotos(pool, t); if (partial.length) break; }
    }
    return { kind: 'none', query: input.trim(), partial, filters: pq };
  }
  if (best) found = [...found].sort((a, b) => (b.aesthetic ?? b.aiScore / 12) - (a.aesthetic ?? a.aiScore / 12));
  else if (pq.newest || (!terms.length && filtered)) found = [...found].sort((a, b) => photoTime(b) - photoTime(a));
  if (pq.limit) found = found.slice(0, pq.limit);
  return { kind: 'results', query: terms.join(' ') || input.trim(), photos: found, best, filters: pq };
}
