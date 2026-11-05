/**
 * lumin/moments.ts
 * Logica pentru „Ai mai fost aici” (locul unei poze noi, unde ai mai fost cu
 * ani în urmă), „Premierele” (prima zăpadă, prima mare, primul tort al unui om)
 * și alegerea pozelor pentru „Un an într-un minut”. Doar din ce știe deja
 * aplicația (GPS-ul din poze, etichetele și descrierile făcute pe telefon).
 */
const DAY = 86_400_000;

export interface MomentPhoto {
  id: string;
  capturedAt?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  personNames?: string[];
  status: string;
  aiScore: number;
  aside?: string;
  sceneSemantic?: string;
  sceneTags?: string[];
  aiDescription?: string;
}

/** Distanța în metri între două puncte (haversine). */
export function meters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BeenHere<P> { recent: P; old: P; years: number; others: P[] }

/**
 * Pozele din ultimele `days` zile făcute într-un loc unde ai mai fost acum cel
 * puțin ~10 luni (sub 250 m). Pentru fiecare loc, cea mai frumoasă poză veche.
 */
export function beenHere<P extends MomentPhoto>(photos: readonly P[], now = Date.now(), days = 3, radius = 250): BeenHere<P>[] {
  const geo = photos.filter(p => p.capturedAt !== undefined && p.gpsLatitude !== undefined && p.gpsLongitude !== undefined && !p.aside);
  const recent = geo.filter(p => now - p.capturedAt! <= days * DAY);
  const old = geo.filter(p => now - p.capturedAt! >= 300 * DAY);
  const out: BeenHere<P>[] = [];
  const usedOld = new Set<string>();
  for (const r of recent.sort((a, b) => b.capturedAt! - a.capturedAt!)) {
    const near = old.filter(o => meters(r.gpsLatitude!, r.gpsLongitude!, o.gpsLatitude!, o.gpsLongitude!) <= radius);
    if (!near.length) continue;
    const best = [...near].sort((a, b) => (b.status === 'selected' ? 100 : 0) + b.aiScore - ((a.status === 'selected' ? 100 : 0) + a.aiScore))[0];
    if (usedOld.has(best.id) || out.some(x => meters(x.recent.gpsLatitude!, x.recent.gpsLongitude!, r.gpsLatitude!, r.gpsLongitude!) <= radius)) continue;
    usedOld.add(best.id);
    const years = Math.max(1, Math.round((r.capturedAt! - best.capturedAt!) / (365.25 * DAY)));
    out.push({ recent: r, old: best, years, others: near.filter(o => o.id !== best.id).slice(0, 8) });
  }
  return out;
}

/** Premierele: cuvinte căutate în etichetele și descrierile pozelor (în engleză, cum le scriu modelele). */
export const FIRSTS: { key: string; re: RegExp }[] = [
  { key: 'snow', re: /\bsnow/ },
  { key: 'sea', re: /\b(beach|sea|ocean|seaside)\b/ },
  { key: 'cake', re: /\b(birthday cake|cake|candles)\b/ },
  { key: 'pool', re: /\b(swimming pool|pool|swimming)\b/ },
  { key: 'bike', re: /\b(bicycle|bike|tricycle)\b/ },
  { key: 'mountain', re: /\b(mountain|mountains|hiking)\b/ },
  { key: 'xmas', re: /\b(christmas tree|christmas|santa)\b/ },
  { key: 'horse', re: /\b(horse|pony)\b/ },
  { key: 'boat', re: /\b(boat|ship|ferry)\b/ },
  { key: 'plane', re: /\b(airplane|aeroplane|plane|airport)\b/ },
  { key: 'zoo', re: /\b(zoo|elephant|giraffe|zebra|lion|tiger)\b/ },
  { key: 'school', re: /\b(school|classroom|backpack)\b/ }
];

function textOf(p: MomentPhoto): string {
  return `${p.sceneSemantic ?? ''} ${(p.sceneTags ?? []).join(' ')} ${p.aiDescription ?? ''}`.toLowerCase();
}

export interface FirstMoment<P> { key: string; photo: P; at: number }

/** Prima poză a omului pentru fiecare premieră găsită, în ordinea timpului. */
export function firstsOf<P extends MomentPhoto>(photos: readonly P[], name: string): FirstMoment<P>[] {
  const mine = photos.filter(p => p.capturedAt !== undefined && !p.aside && p.personNames?.includes(name))
    .sort((a, b) => a.capturedAt! - b.capturedAt!);
  const out: FirstMoment<P>[] = [];
  for (const f of FIRSTS) {
    const hit = mine.find(p => f.re.test(textOf(p)));
    if (hit) out.push({ key: f.key, photo: hit, at: hit.capturedAt! });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * „Un an într-un minut”: cea mai frumoasă poză din fiecare zi a anului, cel mult
 * `max` zile (30 × 2 s ≈ un minut; pași egali dacă sunt mai multe zile), în ordinea timpului.
 */
export function yearDays<P extends MomentPhoto>(photos: readonly P[], year: number, max = 30): P[] {
  const byDay = new Map<number, P>();
  const score = (p: P) => (p.status === 'selected' ? 100 : 0) + p.aiScore;
  for (const p of photos) {
    if (p.capturedAt === undefined || p.aside || p.status === 'rejected') continue;
    const d = new Date(p.capturedAt);
    if (d.getFullYear() !== year) continue;
    const k = Math.floor((p.capturedAt - new Date(year, 0, 1).getTime()) / DAY);
    const cur = byDay.get(k);
    if (!cur || score(p) > score(cur)) byDay.set(k, p);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  if (days.length <= max) return days;
  const out: P[] = [];
  for (let i = 0; i < max; i++) out.push(days[Math.round(i * (days.length - 1) / (max - 1))]);
  return out;
}
