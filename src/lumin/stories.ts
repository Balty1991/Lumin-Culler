/**
 * lumin/stories.ts
 * „Poveștile” de pe Azi: câteva cadre pe tot ecranul, făcute din ce știe deja
 * aplicația (amintirea de azi, cele mai bune poze, ce așteaptă, seriile, oamenii).
 * Logică pură: primește pozele și ora, întoarce cel mult șase povești.
 */
import type { PhotoView } from '../state/store';
import { startOfDay } from '../core/todayDigest';
import { photoTime } from './days';
import { onThisDay } from './momentAlbums';
import { yearSeason, yearStats } from './yearStats';

export type StoryKind = 'year' | 'today' | 'memory' | 'best' | 'waiting' | 'series' | 'person' | 'forgotten';
export interface Story {
  id: string;
  kind: StoryKind;
  cover: PhotoView;
  photos: PhotoView[];
  /** memory: câți ani au trecut. */
  years?: number;
  /** year: anul rezumat. */
  year?: number;
  /** series: câte serii. */
  sets?: number;
  /** person: numele. */
  person?: string;
  /** best: din ultima săptămână (altfel din toată galeria). */
  recent?: boolean;
}

const DAY = 86_400_000;
const score = (p: PhotoView) => (p.aesthetic ?? p.aiScore / 12) + (p.personNames?.length ? 0.6 : 0);
const byScore = (a: PhotoView, b: PhotoView) => score(b) - score(a);

export function buildStories(photos: readonly PhotoView[], now = Date.now(), ritualDoneToday = false): Story[] {
  const out: Story[] = [];
  const used = new Set<string>();
  const push = (s: Story) => { if (!used.has(s.cover.id)) { used.add(s.cover.id); out.push(s); } };
  const kept = photos.filter(p => p.status === 'selected' && !p.aside);

  // Sfârșit de an: „Anul tău în poze”, înaintea tuturor (25 nov. – 15 ian.).
  const season = yearSeason(now);
  const ys = season ? yearStats(photos, season) : null;
  if (ys && ys.best.length) push({ id: `year-${ys.year}`, kind: 'year', cover: ys.best[0], photos: ys.best, year: ys.year });

  // 0. Ritualul zilei: pozele de azi, alese într-un minut (o dată pe zi).
  const today = startOfDay(now);
  const todays = photos.filter(p => !p.aside && startOfDay(photoTime(p)) === today);
  if (todays.length >= 3 && !ritualDoneToday) {
    const list = [...todays].sort((a, b) => photoTime(a) - photoTime(b));
    push({ id: 'today', kind: 'today', cover: [...list].sort(byScore)[0], photos: list });
  }

  // 1. Amintirea de azi (acum un an, doi…).
  const mem = onThisDay(photos as PhotoView[], now)[0];
  if (mem?.photos.length) {
    const list = [...mem.photos].sort(byScore);
    push({ id: `memory-${mem.years}`, kind: 'memory', cover: list[0], photos: list, years: mem.years });
  }

  // 2. Cea mai frumoasă: din ultima săptămână, altfel una din cele mai bune 30, alta în fiecare zi.
  const week = kept.filter(p => photoTime(p) >= now - 7 * DAY).sort(byScore);
  if (week.length >= 2) push({ id: 'best-week', kind: 'best', cover: week[0], photos: week.slice(0, 12), recent: true });
  else if (kept.length >= 3) {
    const top = [...kept].sort(byScore).slice(0, 30);
    const star = top[Math.floor(now / DAY) % top.length];
    const day = startOfDay(photoTime(star));
    const same = kept.filter(p => p.id !== star.id && startOfDay(photoTime(p)) === day).sort(byScore);
    push({ id: `best-${star.id}`, kind: 'best', cover: star, photos: [star, ...same].slice(0, 12) });
  }

  // 3. Ce așteaptă decizia omului.
  const waiting = photos.filter(p => !p.aside && (p.status === 'review' || p.status === 'pending' || p.status === 'candidate'));
  if (waiting.length) {
    const list = [...waiting].sort((a, b) => photoTime(b) - photoTime(a));
    push({ id: 'waiting', kind: 'waiting', cover: [...list].sort(byScore)[0], photos: list });
  }

  // 4. Seriile: pozele în plus, aproape la fel.
  const groups = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (!p.groupId || p.aside) continue;
    const g = groups.get(p.groupId);
    if (g) g.push(p); else groups.set(p.groupId, [p]);
  }
  let sets = 0;
  const extras: PhotoView[] = [];
  let seriesCover: PhotoView | null = null;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const best = g.find(p => p.status === 'selected') ?? [...g].sort((a, b) => b.aiScore - a.aiScore)[0];
    const rest = g.filter(p => p !== best && p.status !== 'selected' && p.mediaUri);
    if (rest.length) { sets++; extras.push(...rest); if (!seriesCover || rest.length > 2) seriesCover = best; }
  }
  if (extras.length >= 3 && seriesCover) push({ id: 'series', kind: 'series', cover: seriesCover, photos: extras, sets });

  // 5. Omul care apare cel mai des.
  const people = new Map<string, PhotoView[]>();
  for (const p of kept) for (const n of p.personNames ?? []) { const l = people.get(n); if (l) l.push(p); else people.set(n, [p]); }
  const topPerson = [...people.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topPerson && topPerson[1].length >= 3) {
    const list = [...topPerson[1]].sort(byScore);
    const cover = list.find(p => !used.has(p.id)) ?? list[0];
    push({ id: `person-${topPerson[0]}`, kind: 'person', cover, photos: list.slice(0, 24), person: topPerson[0] });
  }

  // 6. O poză frumoasă, mai veche de un an.
  const old = kept.filter(p => photoTime(p) < now - 365 * DAY && !used.has(p.id)).sort(byScore).slice(0, 12);
  if (old.length) {
    const star = old[Math.floor(now / (7 * DAY)) % old.length];
    push({ id: `forgotten-${star.id}`, kind: 'forgotten', cover: star, photos: [star, ...old.filter(p => p !== star)] });
  }

  return out.slice(0, 8);
}
