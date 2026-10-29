/**
 * lumin/momentAlbums.ts
 * Albume care se fac singure, pe momente: pozele făcute într-un interval de
 * câteva ore, fără o pauză mare între ele, sunt un „moment” — „Parc · marți
 * după-amiaza”. Numele vine din ce a recunoscut AI-ul cel mai des în poze,
 * coperta e cea mai bună poză păstrată.
 */
import { pickFolderSceneTag, translateSceneTag } from '../core/sceneTagLabels';

export interface AlbumPhoto {
  id: string;
  capturedAt?: number;
  status: string;
  aiScore: number;
  aside?: string;
  sceneTags?: string[];
  personNames: string[];
  lqip?: string;
}

export interface MomentAlbum<P extends AlbumPhoto = AlbumPhoto> {
  id: string;
  start: number;
  end: number;
  photos: P[];
  cover: P;
  /** Eticheta de scenă dominantă (deja tradusă) sau numele cuiva din poze. */
  subject?: string;
  part: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Numele unui eveniment (Crăciun, zi de naștere, vacanță); când e dat, e titlul albumului. */
  title?: string;
  /** Felul evenimentului, pentru pictogramă. */
  kind?: EventKind;
}

export type EventKind = 'christmas' | 'newyear' | 'easter' | 'birthday' | 'party' | 'trip';

/** O pauză mai mare de atât desparte două momente. */
export const ALBUM_GAP_MS = 90 * 60_000;
const MIN_ALBUM = 3;

function partOfDay(at: number): MomentAlbum['part'] {
  const h = new Date(at).getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

export function buildMomentAlbums<P extends AlbumPhoto>(photos: readonly P[], locale: 'ro' | 'en'): MomentAlbum<P>[] {
  const timed = photos.filter(p => p.capturedAt !== undefined && !p.aside).sort((a, b) => a.capturedAt! - b.capturedAt!);
  const groups: P[][] = [];
  for (const p of timed) {
    const g = groups[groups.length - 1];
    if (g && p.capturedAt! - g[g.length - 1].capturedAt! <= ALBUM_GAP_MS) g.push(p);
    else groups.push([p]);
  }
  return groups.filter(g => g.length >= MIN_ALBUM).reverse().map(g => {
    const counts = new Map<string, number>();
    for (const p of g) {
      const tag = pickFolderSceneTag(p.sceneTags);
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const names = new Map<string, number>();
    for (const p of g) for (const n of p.personNames) names.set(n, (names.get(n) ?? 0) + 1);
    const topName = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topTag = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const kept = g.filter(p => p.status === 'selected');
    const cover = [...(kept.length ? kept : g)].sort((a, b) => b.aiScore - a.aiScore)[0];
    const subject = topName ?? (topTag ? translateSceneTag(topTag, locale) : undefined);
    return {
      id: `${g[0].id}-${g.length}`,
      start: g[0].capturedAt!,
      end: g[g.length - 1].capturedAt!,
      photos: g,
      cover,
      subject: subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : undefined,
      part: partOfDay(g[0].capturedAt!)
    };
  });
}

/** Aceeași zi (lună și zi), din anii trecuți: „Acum un an”. */
export function onThisDay<P extends AlbumPhoto>(photos: readonly P[], now: number = Date.now()): { years: number; photos: P[] }[] {
  const today = new Date(now);
  const byYear = new Map<number, P[]>();
  for (const p of photos) {
    if (p.capturedAt === undefined || p.aside) continue;
    const d = new Date(p.capturedAt);
    if (d.getFullYear() >= today.getFullYear()) continue;
    if (d.getMonth() !== today.getMonth() || Math.abs(d.getDate() - today.getDate()) > 1) continue;
    const list = byYear.get(d.getFullYear()) ?? [];
    list.push(p);
    byYear.set(d.getFullYear(), list);
  }
  return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => ({
    years: today.getFullYear() - year,
    photos: [...list].sort((a, b) => (b.status === 'selected' ? 1 : 0) - (a.status === 'selected' ? 1 : 0) || b.aiScore - a.aiScore).slice(0, 6)
  }));
}

const DAY = 86_400_000;
const dayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Paștele ortodox (calendarul iulian, mutat în gregorian): duminica. */
export function orthodoxEaster(year: number): Date {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return new Date(year, month - 1, day + 13);
}

const BIRTHDAY_TAGS = new Set(['birthday', 'cake', 'candle', 'balloon', 'gift', 'confetti']);
const PARTY_TAGS = new Set(['party', 'wedding', 'celebration', 'ceremony', 'festival', 'fireworks']);
const TRIP_TAGS = new Set(['beach', 'sea', 'ocean', 'mountain', 'travel', 'holiday', 'pool', 'lake', 'hotel', 'airport', 'island', 'snow']);

function albumOf<P extends AlbumPhoto>(list: P[], id: string, title: string, kind: EventKind): MomentAlbum<P> {
  const g = [...list].sort((a, b) => a.capturedAt! - b.capturedAt!);
  const kept = g.filter(p => p.status === 'selected');
  const cover = [...(kept.length ? kept : g)].sort((a, b) => b.aiScore - a.aiScore)[0];
  return { id, start: g[0].capturedAt!, end: g[g.length - 1].capturedAt!, photos: g, cover, part: partOfDay(g[0].capturedAt!), title, kind };
}

function topName(list: readonly AlbumPhoto[]): string | undefined {
  const names = new Map<string, number>();
  for (const p of list) for (const n of p.personNames) names.set(n, (names.get(n) ?? 0) + 1);
  return [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Evenimentele din galerie, găsite singure: Crăciunul, Revelionul și Paștele
 * (după dată), zilele de naștere și petrecerile (după ce vede AI-ul în poze:
 * tort, lumânări, baloane), și vacanțele — zile la rând cu mult mai multe poze
 * decât de obicei sau cu mare, munte, piscină.
 */
export function buildEvents<P extends AlbumPhoto>(photos: readonly P[], locale: 'ro' | 'en'): MomentAlbum<P>[] {
  const ro = locale !== 'en';
  const timed = photos.filter(p => p.capturedAt !== undefined && !p.aside);
  const byDay = new Map<number, P[]>();
  for (const p of timed) {
    const d = dayStart(p.capturedAt!);
    const list = byDay.get(d);
    if (list) list.push(p); else byDay.set(d, [p]);
  }
  const out: MomentAlbum<P>[] = [];
  const used = new Set<number>();
  const years = [...new Set(timed.map(p => new Date(p.capturedAt!).getFullYear()))];
  const span = (from: Date, days: number) => Array.from({ length: days }, (_, i) => dayStart(from.getTime() + i * DAY + 3_600_000));
  const holiday = (days: number[], id: string, title: string, kind: EventKind) => {
    const list = days.flatMap(d => byDay.get(d) ?? []);
    if (list.length < 3) return;
    days.forEach(d => used.add(d));
    out.push(albumOf(list, id, title, kind));
  };
  for (const y of years) {
    holiday(span(new Date(y, 11, 24), 3), `xmas-${y}`, ro ? `Crăciunul ${y}` : `Christmas ${y}`, 'christmas');
    holiday([...span(new Date(y, 11, 31), 1), ...span(new Date(y + 1, 0, 1), 1)], `ny-${y}`, ro ? `Revelionul ${y + 1}` : `New Year ${y + 1}`, 'newyear');
    const easter = orthodoxEaster(y);
    holiday(span(new Date(easter.getTime() - DAY), 3), `easter-${y}`, ro ? `Paștele ${y}` : `Easter ${y}`, 'easter');
  }
  // Zile de naștere și petreceri: o zi în care mai multe poze arată tort, lumânări, baloane...
  for (const [d, list] of byDay) {
    if (used.has(d) || list.length < 4) continue;
    const bday = list.filter(p => p.sceneTags?.some(t => BIRTHDAY_TAGS.has(t.toLowerCase()))).length;
    const party = list.filter(p => p.sceneTags?.some(t => PARTY_TAGS.has(t.toLowerCase()))).length;
    const date = new Date(d).toLocaleDateString(ro ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (bday >= 2) {
      const who = topName(list);
      used.add(d);
      out.push(albumOf(list, `bday-${d}`, who ? (ro ? `Ziua lui ${who} · ${date}` : `${who}'s birthday · ${date}`) : (ro ? `Zi de naștere · ${date}` : `Birthday · ${date}`), 'birthday'));
    } else if (party >= 2) {
      used.add(d);
      out.push(albumOf(list, `party-${d}`, ro ? `Petrecere · ${date}` : `Party · ${date}`, 'party'));
    }
  }
  // Vacanțe: cel puțin 2 zile la rând, fiecare cu mult peste ziua obișnuită (sau cu peisaje de vacanță).
  const counts = [...byDay.values()].map(l => l.length).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  const busy = (d: number) => {
    const list = byDay.get(d);
    if (!list || used.has(d)) return false;
    const tripLike = list.filter(p => p.sceneTags?.some(t => TRIP_TAGS.has(t.toLowerCase()))).length >= Math.max(2, list.length * 0.25);
    return list.length >= Math.max(8, median * 2.5) || (tripLike && list.length >= 4);
  };
  const days = [...byDay.keys()].sort((a, b) => a - b);
  for (let i = 0; i < days.length; i++) {
    if (!busy(days[i])) continue;
    let j = i;
    while (j + 1 < days.length && days[j + 1] - days[j] <= DAY * 1.5 && busy(days[j + 1])) j++;
    if (j > i) {
      const run = days.slice(i, j + 1);
      const list = run.flatMap(d => byDay.get(d)!);
      const fmt = (d: number, o: Intl.DateTimeFormatOptions) => new Date(d).toLocaleDateString(ro ? 'ro-RO' : 'en-GB', o);
      const range = `${fmt(run[0], { day: 'numeric' })}–${fmt(run[run.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}`;
      run.forEach(d => used.add(d));
      out.push(albumOf(list, `trip-${run[0]}`, ro ? `Vacanță · ${range}` : `Trip · ${range}`, 'trip'));
    }
    i = j;
  }
  return out.sort((a, b) => b.start - a.start);
}

/**
 * „Cele mai bune 30” dintr-o vacanță de 300: timpul împărțit în `n` bucăți
 * egale (ca să fie și începutul, și sfârșitul, și fiecare loc), iar din fiecare
 * bucată cea mai bună poză (păstrată întâi, apoi cu oameni, apoi scor). Dacă
 * unele bucăți sunt goale, golurile se umplu cu următoarele cele mai bune.
 */
export function bestSpread<P extends AlbumPhoto>(photos: readonly P[], n: number): P[] {
  const list = photos.filter(p => p.capturedAt !== undefined);
  if (list.length <= n) return [...list];
  const score = (p: P) => (p.status === 'selected' ? 1000 : 0) + (p.personNames.length ? 15 : 0) + p.aiScore;
  const start = Math.min(...list.map(p => p.capturedAt!));
  const end = Math.max(...list.map(p => p.capturedAt!));
  const span = Math.max(1, end - start + 1);
  const buckets = new Map<number, P>();
  for (const p of list) {
    const b = Math.min(n - 1, Math.floor(((p.capturedAt! - start) / span) * n));
    const cur = buckets.get(b);
    if (!cur || score(p) > score(cur)) buckets.set(b, p);
  }
  const chosen = new Set(buckets.values());
  for (const p of [...list].sort((a, b) => score(b) - score(a))) {
    if (chosen.size >= n) break;
    chosen.add(p);
  }
  return [...chosen].sort((a, b) => a.capturedAt! - b.capturedAt!);
}
