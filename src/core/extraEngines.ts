/**
 * core/extraEngines.ts
 * Punți către Florence-2 (descrierea pozei, FlorencePlugin.kt) și FER+
 * (expresia fețelor, EmotionPlugin.kt). Doar Android; pe web întorc null.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface FlorenceApi {
  available(): Promise<{ ready: boolean }>;
  prepare(): Promise<{ ready: boolean }>;
  close(): Promise<void>;
  caption(o: { imageUri: string; maxSide?: number }): Promise<{ caption: string }>;
}
interface EmotionApi {
  faces(o: { imageUri: string; maxSide?: number; boxes: number[][] }): Promise<{ faces: number[][] }>;
}
const Florence = registerPlugin<FlorenceApi>('Florence');
const Emotion = registerPlugin<EmotionApi>('Emotion');

const has = (name: string) => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name);

export async function prepareFlorence(): Promise<boolean> {
  if (!has('Florence')) return false;
  try { return (await Florence.prepare()).ready; } catch { return false; }
}
export async function captionPhoto(uri: string): Promise<string | null> {
  if (!has('Florence')) return null;
  try { const c = (await Florence.caption({ imageUri: uri, maxSide: 1024 })).caption.trim(); return c.length > 3 ? c : null; } catch { return null; }
}
export async function closeFlorence(): Promise<void> {
  if (has('Florence')) await Florence.close().catch(() => undefined);
}

/** Cât de tare se bucură cea mai veselă față din poză (0..1), după FER+. */
export async function joyOf(uri: string, boxes: number[][]): Promise<number | null> {
  if (!has('Emotion') || !boxes.length) return null;
  try {
    const { faces } = await Emotion.faces({ imageUri: uri, maxSide: 1600, boxes });
    const joys = faces.filter(f => f.length === 8).map(f => f[1]);
    return joys.length ? Math.max(...joys) : null;
  } catch { return null; }
}
