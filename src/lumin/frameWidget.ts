import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * lumin/frameWidget.ts
 * „Rama vie” (FrameWidgetProvider.kt): ce poze arată widgetul. Cele mai frumoase
 * poze păstrate cu oameni, câte una pe lună (ca rama să plimbe prin ani, nu prin
 * aceeași zi), amestecate, fiecare cu o etichetă scurtă.
 */
export interface FramePhoto { id: string; mediaUri?: string; capturedAt?: number; status: string; faceCount: number; aiScore: number; aside?: string }

export function framePicks<P extends FramePhoto>(photos: readonly P[], max = 48): P[] {
  const byMonth = new Map<number, P>();
  for (const p of photos) {
    if (p.status !== 'selected' || !p.mediaUri || p.aside || p.faceCount === 0 || p.capturedAt === undefined) continue;
    const d = new Date(p.capturedAt);
    const k = d.getFullYear() * 12 + d.getMonth();
    const cur = byMonth.get(k);
    if (!cur || p.aiScore > cur.aiScore) byMonth.set(k, p);
  }
  const list = [...byMonth.values()].sort((a, b) => b.aiScore - a.aiScore).slice(0, max);
  // Amestecate, dar la fel la fiecare pornire (rama nu sare înapoi la început).
  return list.sort((a, b) => hash(a.id) - hash(b.id));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

interface FrameApi {
  updateFrameWidget(o: { items: { uri: string; label: string }[] }): Promise<void>;
  canPinFrameWidget(): Promise<{ supported: boolean }>;
  pinFrameWidget(): Promise<{ asked: boolean }>;
}
const Native = registerPlugin<FrameApi>('Notifications');

export async function updateFrameWidget(items: { uri: string; label: string }[]): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Notifications')) return;
  try { await Native.updateFrameWidget({ items }); } catch { /* versiune nativă mai veche */ }
}

/** Poate telefonul să pună widgetul pe ecran la cererea aplicației? Fals pe web și pe versiuni native vechi. */
export async function canPinFrameWidget(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Notifications')) return false;
  try { return (await Native.canPinFrameWidget()).supported; } catch { return false; }
}
/** Deschide dialogul sistemului „Adaugă pe ecranul principal”. Întoarce dacă cererea a pornit. */
export async function pinFrameWidget(): Promise<boolean> {
  try { return (await Native.pinFrameWidget()).asked; } catch { return false; }
}
