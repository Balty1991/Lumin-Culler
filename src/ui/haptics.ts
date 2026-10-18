/**
 * Vibrație scurtă la pragul unui gest. Pe telefon trece prin plugin-ul
 * Capacitor LuminHaptics. Pe web, Vibration API, iar dacă lipsește nu face nimic.
 * `prefers-reduced-motion` oprește vibrația: e același semnal ca animația.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface LuminHapticsPlugin {
  impact(options: { style: 'light' | 'medium' }): Promise<void>;
}

const LuminHaptics = registerPlugin<LuminHapticsPlugin>('LuminHaptics');

export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Vibration API — suportată pe Android, no-op unde lipsește. */
export function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* API opțională */ }
}

export function tickHaptic(style: 'light' | 'medium' = 'light'): void {
  if (!motionAllowed()) return;
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LuminHaptics')) {
    void LuminHaptics.impact({ style }).catch(() => undefined);
    return;
  }
  vibrate(style === 'medium' ? 18 : 10);
}
