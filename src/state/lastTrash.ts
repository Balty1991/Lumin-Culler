/**
 * state/lastTrash.ts
 * Ultimele poze mutate în coșul galeriei, ca să poată fi puse înapoi cu
 * „Anulează” câteva secunde (vezi lumin/UndoBar.tsx). Doar în memorie.
 */
type Listener = (t: { uris: string[]; at: number } | null) => void;
let last: { uris: string[]; at: number } | null = null;
const listeners = new Set<Listener>();

export function setLastTrash(uris: string[]): void {
  last = uris.length ? { uris, at: Date.now() } : null;
  listeners.forEach(l => l(last));
}
export function clearLastTrash(): void { setLastTrash([]); }
export function onLastTrash(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Verificarea dinainte: când pleacă mai mult de câteva poze deodată, interfața
 * (lumin/TrashPreview.tsx) arată exemple și cere „Da”. Fără gardă înregistrată
 * (teste, vechea interfață), ștergerea merge ca înainte.
 */
type Guard = (ids: string[]) => Promise<boolean>;
let guard: Guard | null = null;
export function setTrashGuard(g: Guard | null): void { guard = g; }
export async function passTrashGuard(ids: string[]): Promise<boolean> {
  return guard ? guard(ids) : true;
}
