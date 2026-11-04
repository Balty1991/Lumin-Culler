import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * lumin/capsule.ts
 * „Capsula timpului”: câteva poze de azi și un mesaj, sigilate până la o zi
 * aleasă (peste o lună, 6 luni, un an). În ziua aceea vine o notificare și
 * capsula se deschide pe Azi, cu animație. Totul rămâne pe telefon.
 *
 * Ținute în localStorage (puține date: id-uri de poze și un text).
 */
export interface Capsule {
  id: number;
  photoIds: string[];
  message: string;
  createdAt: number;
  openAt: number;
  /** Omul a văzut-o deschisă (nu mai apare ca „s-a deschis!”). */
  seen?: boolean;
}

const KEY = 'lx.capsules.v1';

export function readCapsules(): Capsule[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Capsule[]) : [];
    return Array.isArray(list) ? list.filter(c => c && Array.isArray(c.photoIds)) : [];
  } catch { return []; }
}

function write(list: Capsule[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* fără spațiu: rămâne cum era */ }
  window.dispatchEvent(new Event('lx-capsules'));
}

interface CapsuleApi {
  scheduleCapsule(o: { id: number; at: number; title: string; body: string }): Promise<void>;
  cancelCapsule(o: { id: number }): Promise<void>;
}
const Native = registerPlugin<CapsuleApi>('Notifications');
const nativeOk = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Notifications');

/** Ora la care se deschide: dimineața, la 10, în ziua aleasă. */
export function openTimeFor(monthsAhead: number, from = Date.now()): number {
  const d = new Date(from);
  d.setMonth(d.getMonth() + monthsAhead);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

export function isOpen(c: Capsule, now = Date.now()): boolean {
  return now >= c.openAt;
}

export function addCapsule(photoIds: string[], message: string, openAt: number, notify: { title: string; body: string }): Capsule {
  const list = readCapsules();
  const id = (list.reduce((m, c) => Math.max(m, c.id), 0) + 1) % 900;
  const c: Capsule = { id, photoIds, message: message.trim(), createdAt: Date.now(), openAt };
  write([...list, c]);
  if (nativeOk()) void Native.scheduleCapsule({ id, at: openAt, ...notify }).catch(() => {});
  return c;
}

export function markSeen(id: number): void {
  write(readCapsules().map(c => (c.id === id ? { ...c, seen: true } : c)));
}

export function removeCapsule(id: number): void {
  write(readCapsules().filter(c => c.id !== id));
  if (nativeOk()) void Native.cancelCapsule({ id }).catch(() => {});
}

/**
 * La fiecare pornire: alarmele capsulelor încă sigilate se refac (Android le
 * pierde la repornirea telefonului). Textul notificării vine din limba aplicației.
 */
export function rescheduleCapsules(textFor: (c: Capsule) => { title: string; body: string }): void {
  if (!nativeOk()) return;
  const now = Date.now();
  for (const c of readCapsules()) if (c.openAt > now) void Native.scheduleCapsule({ id: c.id, at: c.openAt, ...textFor(c) }).catch(() => {});
}
