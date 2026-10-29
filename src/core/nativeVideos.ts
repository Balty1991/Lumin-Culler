import { registerPlugin } from '@capacitor/core';
import { isNativeMediaLibraryAvailable } from './nativeMediaLibrary';

/**
 * core/nativeVideos.ts
 * Clipurile video din galerie, pentru curățenie: de obicei ele ocupă cel mai
 * mult loc, iar aplicația nu le vedea deloc. Se listează doar (mărime, durată,
 * dată), fără să se citească vreun clip; ștergerea trece prin coșul Android.
 */
export interface GalleryVideo {
  uri: string;
  name: string;
  sizeBytes: number;
  durationMs: number;
  capturedAt: number;
  width: number;
  height: number;
  folder: string;
}

interface VideoPluginApi {
  listVideos(): Promise<{ granted: boolean; videos: GalleryVideo[] }>;
  videoThumbnail(options: { uri: string; size?: number }): Promise<{ data?: string }>;
}
const Native = registerPlugin<VideoPluginApi>('MediaLibrary');

export async function listGalleryVideos(): Promise<{ granted: boolean; videos: GalleryVideo[] }> {
  if (!isNativeMediaLibraryAvailable()) return { granted: false, videos: [] };
  return Native.listVideos();
}

const thumbs = new Map<string, Promise<string | null>>();
export function videoThumbUrl(uri: string): Promise<string | null> {
  let p = thumbs.get(uri);
  if (!p) {
    p = Native.videoThumbnail({ uri, size: 320 }).then(r => (r.data ? `data:image/jpeg;base64,${r.data}` : null)).catch(() => null);
    thumbs.set(uri, p);
  }
  return p;
}

export interface VideoCleanup {
  /** Copii ale aceluiași clip (aceeași mărime și durată): rămâne cel mai vechi. */
  duplicates: GalleryVideo[];
  /** Clipuri de o clipă, pornite din greșeală (sub 2 secunde). */
  accidental: GalleryVideo[];
  /** Cele mai mari clipuri (peste 50 MB), cele mai mari întâi. Doar arătate, nu propuse la ștergere. */
  big: GalleryVideo[];
}

export const ACCIDENTAL_MS = 2000;
export const BIG_BYTES = 50 * 1024 * 1024;

export function findVideoCleanup(videos: readonly GalleryVideo[]): VideoCleanup {
  const groups = new Map<string, GalleryVideo[]>();
  for (const v of videos) {
    if (!v.sizeBytes) continue;
    // Durata rotunjită la jumătăți de secundă: copiile au aceeași mărime, iar durata
    // raportată poate diferi cu câteva milisecunde între două fișiere identice.
    const key = `${v.sizeBytes}:${Math.round(v.durationMs / 500)}`;
    const g = groups.get(key);
    if (g) g.push(v); else groups.set(key, [v]);
  }
  const duplicates: GalleryVideo[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = [...g].sort((a, b) => a.capturedAt - b.capturedAt)[0];
    duplicates.push(...g.filter(v => v !== keep));
  }
  const dupe = new Set(duplicates.map(v => v.uri));
  const accidental = videos.filter(v => !dupe.has(v.uri) && v.durationMs > 0 && v.durationMs < ACCIDENTAL_MS);
  const big = videos.filter(v => !dupe.has(v.uri) && v.sizeBytes >= BIG_BYTES).sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 30);
  return { duplicates, accidental, big };
}

export const videoBytes = (list: readonly GalleryVideo[]) => list.reduce((s, v) => s + v.sizeBytes, 0);
