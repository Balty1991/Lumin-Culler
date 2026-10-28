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
}

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
