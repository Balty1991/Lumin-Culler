/**
 * lumin/assistantBrain.ts
 * „Întreabă-ți galeria”: înțelege ce cere omul și răspunde din ce știe deja
 * aplicația (căutarea pe cuvinte, oamenii, datele, seriile). Rulează pe telefon,
 * fără server: reguli simple pentru intenții, apoi căutarea obișnuită.
 */
import type { PhotoView } from '../state/store';
import { fold, searchPhotos } from './textSearch';
import { photoTime } from './days';

export type AssistantReply =
  | { kind: 'results'; query: string; photos: PhotoView[]; best: boolean }
  | { kind: 'none'; query: string }
  | { kind: 'stats'; total: number; kept: number; waiting: number; extras: number; people: number }
  | { kind: 'cleanup'; photos: PhotoView[]; sets: number; screenshots: number }
  | { kind: 'waiting'; photos: PhotoView[] }
  | { kind: 'train' }
  | { kind: 'studio' }
  | { kind: 'add' };

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
  if (has(q, /\b(film|video|clip|colaj|collage|movie|studio)\w*/)) return { kind: 'studio' };

  const best = has(q, /\b(cele mai|cea mai|best|top|frumoas|reusit|beautiful)\w*/);
  const terms = q.split(' ').filter(w => w.length > 1 && !FILLER.has(w) && !/^(bune|buna|frumoase|frumoasa|reusite|best|top|beautiful)$/.test(w));
  const pool = photos.filter(p => !p.aside || /bon|document|captur|screenshot|receipt/.test(q));
  let found = terms.length ? searchPhotos(pool, terms.join(' ')) : [];
  // Niciun rezultat cu toate cuvintele: încearcă pe rând, de la cel mai lung (de obicei subiectul).
  if (!found.length && terms.length > 1) {
    for (const t of [...terms].sort((a, b) => b.length - a.length)) { found = searchPhotos(pool, t); if (found.length) break; }
  }
  if (!terms.length && best) found = photos.filter(p => p.status === 'selected' && !p.aside);
  if (!found.length) return { kind: 'none', query: input.trim() };
  if (best) found = [...found].sort((a, b) => (b.aesthetic ?? b.aiScore / 12) - (a.aesthetic ?? a.aiScore / 12));
  return { kind: 'results', query: terms.join(' ') || input.trim(), photos: found, best };
}
