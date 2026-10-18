/**
 * core/nativeVideoCompress.ts
 * Comprimare locală. Plugin-ul scrie un fișier nou și lasă originalul neatins.
 * Ștergerea originalului, dacă omul o cere, rămâne la dialogul sistemului.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface CompressResult {
  uri: string;
  originalBytes: number;
  newBytes: number;
  savedBytes: number;
}

interface VideoCompressPluginApi {
  compress(options: { uri: string; bytes: string; name: string }): Promise<CompressResult>;
}

const VideoCompressNative = registerPlugin<VideoCompressPluginApi>('VideoCompress');

export function isVideoCompressAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('VideoCompress');
}

export async function compressVideo(options: { uri: string; bytes: number; name: string }): Promise<CompressResult> {
  return VideoCompressNative.compress({
    uri: options.uri,
    bytes: String(Math.max(0, Math.floor(options.bytes))),
    name: options.name
  });
}
