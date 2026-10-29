/**
 * core/todayDigest.ts
 * „Ziua de azi”: pozele făcute azi, câte a păstrat AI-ul și câte mai ai de
 * văzut. Plus puntea spre notificarea de seară (plugins/DailyDigestReceiver.kt).
 *
 * Scopul aplicației, spus de utilizator: „fac multe poze, dar uit să le
 * sortez; din 20–30 pe zi aș opri 3–5”. Ziua e unitatea firească: puține
 * poze, o decizie de 30 de secunde, în fiecare seară.
 */
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { isReviewQueue } from './singletonVerdict';

export interface DayPhoto {
  id: string;
  capturedAt?: number;
  status: string;
  aside?: string;
}

export interface DayStats {
  total: number;
  kept: number;
  rejected: number;
  /** Pozele de azi care încă așteaptă un „da” sau „nu” de la om. */
  reviewIds: string[];
  keptIds: string[];
}

export function startOfDay(at: number = Date.now()): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayStats(photos: readonly DayPhoto[], now: number = Date.now()): DayStats {
  const from = startOfDay(now);
  const today = photos.filter(p => p.capturedAt !== undefined && p.capturedAt >= from && p.capturedAt <= now && !p.aside);
  return {
    total: today.length,
    kept: today.filter(p => p.status === 'selected').length,
    rejected: today.filter(p => p.status === 'rejected').length,
    reviewIds: today.filter(p => p.status === 'review' && isReviewQueue(p)).map(p => p.id),
    keptIds: today.filter(p => p.status === 'selected').map(p => p.id)
  };
}

interface DigestPluginApi {
  scheduleDailyDigest(options: { hour: number; minute: number; title: string; body: string; channelName: string; shareLabel?: string; dayLabel?: string }): Promise<void>;
  cancelDailyDigest(): Promise<void>;
  scheduleMorningMemory(options: { hour: number; minute: number; texts: Record<string, string>; picks: Record<string, { uri: string; years: number }> }): Promise<void>;
  consumeLaunchAction(): Promise<{ action?: string }>;
  updateWidget(options: { title: string; subtitle: string; uri?: string; shareLabel?: string }): Promise<void>;
  addListener(event: 'launchAction', cb: (data: { action: string }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<DigestPluginApi>('Notifications');

function available(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Notifications');
}

/** Ora notificării de seară: după ce s-a făcut ziua, înainte de somn. */
export const DIGEST_HOUR = 20;
export const DIGEST_MINUTE = 30;

export async function scheduleDailyDigest(texts: { title: string; body: string; channelName: string; shareLabel?: string; dayLabel?: string }): Promise<void> {
  if (!available()) return;
  try {
    await Native.scheduleDailyDigest({ hour: DIGEST_HOUR, minute: DIGEST_MINUTE, ...texts });
  } catch {
    // fără notificare de seară, aplicația merge la fel
  }
}

/** „Acum un an”, dimineața (MorningMemoryReceiver.kt): după ce te-ai trezit, înainte de muncă. */
export const MEMORY_HOUR = 9;
export const MEMORY_MINUTE = 15;

export async function scheduleMorningMemory(texts: Record<string, string>, picks: Record<string, { uri: string; years: number }>): Promise<void> {
  if (!available()) return;
  try {
    await Native.scheduleMorningMemory({ hour: MEMORY_HOUR, minute: MEMORY_MINUTE, texts, picks });
  } catch {
    // o versiune nativă mai veche: fără amintirea de dimineață
  }
}

/**
 * Cu ce a fost deschisă aplicația din notificarea de seară sau din widget:
 * „today” (sortează ziua), „share_pod” (trimite poza zilei), „see_day” (vezi ziua).
 */
export type LaunchAction = 'today' | 'share_pod' | 'see_day' | 'share_memory' | 'see_memory' | 'search' | 'map';
/** „search” și „map” vin din scurtăturile de pe iconiță (res/xml/shortcuts.xml). */
const LAUNCH_ACTIONS: readonly string[] = ['today', 'share_pod', 'see_day', 'share_memory', 'see_memory', 'search', 'map'];

/** Cheamă `cb` când aplicația e deschisă din notificarea „Ziua de azi” sau din widget (la pornire sau din fundal). */
export async function onTodayLaunch(cb: (action: LaunchAction) => void): Promise<() => void> {
  if (!available()) return () => {};
  let handle: PluginListenerHandle | null = null;
  try {
    handle = await Native.addListener('launchAction', data => { if (LAUNCH_ACTIONS.includes(data.action)) cb(data.action as LaunchAction); });
    const first = await Native.consumeLaunchAction();
    if (first.action && LAUNCH_ACTIONS.includes(first.action)) cb(first.action as LaunchAction);
  } catch {
    // plugin vechi: doar fără deschiderea directă
  }
  return () => { void handle?.remove(); };
}

/** Widgetul de pe ecranul telefonului: textul și poza zilei (LuminWidgetProvider.kt). */
export async function updateHomeWidget(options: { title: string; subtitle: string; uri?: string; shareLabel?: string }): Promise<void> {
  if (!available()) return;
  try {
    await Native.updateWidget(options);
  } catch {
    // o versiune nativă mai veche, fără widget: nimic de făcut
  }
}
