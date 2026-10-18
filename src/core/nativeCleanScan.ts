/**
 * core/nativeCleanScan.ts
 * Punte către CleanScanPlugin: metadate de galerie, nu decizia de ștergere.
 *
 * Pe web plugin-ul nu există. Apelantul tratează asta ca „nu am ce scana” și
 * arată coșurile din pozele deja importate.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CleanImageRow, CleanVideoRow } from './cleanScan';

export type VideoAccess = 'full' | 'denied' | 'unavailable';

export interface GalleryScan {
  granted: boolean;
  videosGranted: boolean;
  images: CleanImageRow[];
  videos: CleanVideoRow[];
}

interface CleanScanPluginApi {
  videoAccess(): Promise<{ access: 'full' | 'denied' }>;
  requestVideoAccess(): Promise<{ access: 'full' | 'denied' }>;
  scan(): Promise<{
    granted: boolean;
    videosGranted: boolean;
    images?: CleanImageRow[];
    videos?: CleanVideoRow[];
  }>;
}

const CleanScanNative = registerPlugin<CleanScanPluginApi>('CleanScan');

export function isCleanScanAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('CleanScan');
}

export async function readVideoAccess(): Promise<VideoAccess> {
  if (!isCleanScanAvailable()) return 'unavailable';
  try {
    const result = await CleanScanNative.videoAccess();
    return result.access === 'full' ? 'full' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function requestVideoAccess(): Promise<VideoAccess> {
  if (!isCleanScanAvailable()) return 'unavailable';
  try {
    const result = await CleanScanNative.requestVideoAccess();
    return result.access === 'full' ? 'full' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function scanGallery(): Promise<GalleryScan> {
  const result = await CleanScanNative.scan();
  return {
    granted: result.granted === true,
    videosGranted: result.videosGranted === true,
    images: Array.isArray(result.images) ? result.images : [],
    videos: Array.isArray(result.videos) ? result.videos : []
  };
}
