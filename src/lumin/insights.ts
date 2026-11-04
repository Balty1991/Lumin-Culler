/**
 * lumin/insights.ts
 * Ce lipsește din poze și profilul tău de fotograf, calculate din ce știe deja
 * aplicația (cine e în poze, când, ce păstrezi). Fără rețea, fără modele noi.
 */
const DAY = 86_400_000;

export interface InsightPhoto {
  id: string;
  capturedAt?: number;
  personNames?: string[];
  status: string;
  aiScore: number;
  sceneSemantic?: string;
  sceneTags?: string[];
  goldenHourDetected?: boolean;
  faceCount?: number;
}

export type MissingInsight =
  | { kind: 'person'; key: string; name: string; days: number; lastId: string }
  | { kind: 'pair'; key: string; a: string; b: string; days: number; lastId: string };

/**
 * „N-ai mai făcut nicio poză cu Ami de 6 săptămâni”, „Ami și Tata n-au mai apărut
 * împreună de 4 luni”. Doar pentru oamenii care apar des (altfel ar fi zgomot),
 * cel mult două, cele mai importante întâi.
 */
export function missingInsights(photos: readonly InsightPhoto[], now = Date.now()): MissingInsight[] {
  const timed = photos.filter(p => p.capturedAt !== undefined && p.capturedAt <= now);
  const byPerson = new Map<string, InsightPhoto[]>();
  for (const p of timed) for (const n of p.personNames ?? []) byPerson.set(n, [...(byPerson.get(n) ?? []), p]);
  const top = [...byPerson.entries()].filter(([, l]) => l.length >= 12).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  const out: (MissingInsight & { weight: number })[] = [];
  for (const [name, list] of top) {
    const last = list.reduce((m, p) => (p.capturedAt! > m.capturedAt! ? p : m));
    const days = Math.floor((now - last.capturedAt!) / DAY);
    // Apărea des înainte (cel puțin 4 poze în cele 90 de zile dinaintea ultimei), acum de mult nu.
    const before = list.filter(p => p.capturedAt! >= last.capturedAt! - 90 * DAY).length;
    if (days >= 42 && before >= 4) out.push({ kind: 'person', key: `p:${name}`, name, days, lastId: last.id, weight: list.length + days / 7 });
  }
  const names = top.slice(0, 5).map(([n]) => n);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const together = timed.filter(p => p.personNames?.includes(a) && p.personNames.includes(b));
    if (together.length < 3) continue;
    const last = together.reduce((m, p) => (p.capturedAt! > m.capturedAt! ? p : m));
    const days = Math.floor((now - last.capturedAt!) / DAY);
    // Cei doi apar separat recent, dar nu împreună.
    const recentA = byPerson.get(a)!.some(p => now - p.capturedAt! < 30 * DAY);
    const recentB = byPerson.get(b)!.some(p => now - p.capturedAt! < 30 * DAY);
    if (days >= 60 && recentA && recentB) out.push({ kind: 'pair', key: `pp:${a}|${b}`, a, b, days, lastId: last.id, weight: together.length * 2 + days / 7 });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 2).map(({ weight: _w, ...rest }) => rest);
}

export type Archetype = 'family' | 'explorer' | 'foodie' | 'night' | 'light' | 'pets' | 'storyteller';

export interface PhotoProfile {
  from: number;
  to: number;
  total: number;
  kept: number;
  keepRate: number;
  people: { name: string; count: number }[];
  hour: number | null;
  weekday: number | null;
  bestId: string | null;
  archetype: Archetype;
  goldenCount: number;
}

const FOOD = /pizza|cake|donut|sandwich|food|dish|meal|dessert|fruit|banana|apple|orange|broccoli|hot dog|bread|coffee|wine|cup/i;
const NATURE = /mountain|sea|ocean|beach|lake|river|forest|tree|sky|cloud|field|grass|flower|landscape|sunset|snow|waterfall|plant/i;
const PETS = /\b(dog|cat|bird|horse)\b/i;

/** Profilul unei perioade: ce păstrezi, cu cine, când, și „ce fel de fotograf ești”. */
export function photoProfile(photos: readonly InsightPhoto[], from: number, to: number): PhotoProfile {
  const inRange = photos.filter(p => p.capturedAt !== undefined && p.capturedAt >= from && p.capturedAt < to);
  const kept = inRange.filter(p => p.status === 'selected');
  const base = kept.length >= 5 ? kept : inRange;
  const people = new Map<string, number>();
  for (const p of base) for (const n of p.personNames ?? []) people.set(n, (people.get(n) ?? 0) + 1);
  const hours = new Array(24).fill(0), days = new Array(7).fill(0);
  for (const p of base) { const d = new Date(p.capturedAt!); hours[d.getHours()]++; days[d.getDay()]++; }
  const argmax = (a: number[]) => (a.some(x => x > 0) ? a.indexOf(Math.max(...a)) : null);
  const text = (p: InsightPhoto) => `${p.sceneSemantic ?? ''} ${(p.sceneTags ?? []).join(' ')}`;
  const share = (f: (p: InsightPhoto) => boolean) => (base.length ? base.filter(f).length / base.length : 0);
  const withPeople = share(p => (p.faceCount ?? 0) > 0 || (p.personNames?.length ?? 0) > 0);
  const food = share(p => FOOD.test(text(p)));
  const nature = share(p => NATURE.test(text(p)));
  const pets = share(p => PETS.test(text(p)));
  const night = share(p => { const h = new Date(p.capturedAt!).getHours(); return h >= 20 || h < 5; });
  const golden = base.filter(p => p.goldenHourDetected).length;
  const scores: [Archetype, number][] = [
    ['family', withPeople * (people.size > 0 ? 1.1 : 0.8)],
    ['explorer', nature * 1.4],
    ['foodie', food * 2.2],
    ['pets', pets * 2],
    ['night', night * 1.6],
    ['light', (base.length ? golden / base.length : 0) * 2.5]
  ];
  const best = scores.sort((a, b) => b[1] - a[1])[0];
  const bestPhoto = (kept.length ? kept : inRange).reduce<InsightPhoto | null>((m, p) => (!m || p.aiScore > m.aiScore ? p : m), null);
  return {
    from, to,
    total: inRange.length,
    kept: kept.length,
    keepRate: inRange.length ? Math.round(kept.length / inRange.length * 100) : 0,
    people: [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
    hour: argmax(hours),
    weekday: argmax(days),
    bestId: bestPhoto?.id ?? null,
    archetype: best[1] >= 0.25 ? best[0] : 'storyteller',
    goldenCount: golden
  };
}

/** Luna de arătat: cea trecută (întreagă) în prima jumătate a lunii, altfel luna curentă. */
export function profilePeriod(now = Date.now()): { from: number; to: number } {
  const d = new Date(now);
  if (d.getDate() <= 15) {
    const from = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    return { from, to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
  }
  return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now + 1 };
}

/** Perechi pentru „Duelul”: două poze foarte asemănătoare (aceeași serie), încă nedecise între ele. */
export function duelPairs<P extends InsightPhoto & { groupId?: string }>(photos: readonly P[], max = 10): [P, P][] {
  const groups = new Map<string, P[]>();
  for (const p of photos) if (p.groupId && p.status !== 'rejected') groups.set(p.groupId, [...(groups.get(p.groupId) ?? []), p]);
  const pairs: [P, P][] = [];
  const sorted = [...groups.values()].filter(g => g.length >= 2 && !(g.filter(p => p.status === 'selected').length === 1 && g.length === 2))
    .sort((a, b) => Math.max(...b.map(p => p.capturedAt ?? 0)) - Math.max(...a.map(p => p.capturedAt ?? 0)));
  for (const g of sorted) {
    const top = [...g].sort((a, b) => b.aiScore - a.aiScore).slice(0, 2);
    // Ordinea pe ecran amestecată, ca AI-ul să nu „sufle” răspunsul.
    pairs.push((top[0].id < top[1].id ? [top[0], top[1]] : [top[1], top[0]]) as [P, P]);
    if (pairs.length >= max) break;
  }
  return pairs;
}
