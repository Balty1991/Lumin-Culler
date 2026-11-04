/**
 * core/deviceClass.ts
 * Telefon slab (sub ~4,5 GB RAM): trecerile grele lucrează mai mic sau deloc,
 * ca sistemul să nu închidă aplicația. Pe web: considerat puternic.
 */
import { Capacitor } from '@capacitor/core';
import { ClipNative } from './clip/clipEngine';

let cached: Promise<number> | null = null;

export function ramMb(): Promise<number> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(8000);
  cached ??= (ClipNative as unknown as { device(): Promise<{ ramMb: number }> }).device().then(r => r.ramMb).catch(() => 8000);
  return cached;
}

export async function weakDevice(): Promise<boolean> {
  return (await ramMb()) < 4500;
}
