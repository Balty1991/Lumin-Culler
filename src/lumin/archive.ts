import { create } from 'zustand';
import type { PhotoView } from '../state/store';
import { photoTime } from './days';

/**
 * lumin/archive.ts
 * Arhiva inteligentă: pozele vechi și slabe pleacă din Galerie, Azi, momente
 * și căutare într-o „Arhivă” separată — fără să fie șterse, nici din telefon,
 * nici din aplicație. Le scoți oricând înapoi.
 *
 * Ce intră (doar la arhivarea automată sau la „Arhivează acum”):
 *  - mai vechi de un an;
 *  - nepăstrate de tine (nu „Păstrez”);
 *  - scor sub mijloc (sub 50 din 100), deci nici bune, nici alese;
 *  - fără oameni sau animale numite, fără editări, fără documente puse deoparte.
 *
 * Lista stă în localStorage (doar id-uri).
 */
const KEY = 'lumin-archive';
const AUTO_KEY = 'lumin-archive-auto';
const LAST_KEY = 'lumin-archive-at';
const YEAR = 365 * 86_400_000;
const WEEK = 7 * 86_400_000;
export const ARCHIVE_SCORE = 50;

function read(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]') as string[]); } catch { return new Set(); }
}
function write(ids: Set<string>): void {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch { /* fără stocare */ }
}

interface ArchiveState {
  ids: ReadonlySet<string>;
  add: (ids: readonly string[]) => void;
  remove: (ids: readonly string[]) => void;
}

export const useArchive = create<ArchiveState>(set => ({
  ids: read(),
  add: ids => set(s => { const next = new Set(s.ids); ids.forEach(id => next.add(id)); write(next); return { ids: next }; }),
  remove: ids => set(s => { const next = new Set(s.ids); ids.forEach(id => next.delete(id)); write(next); return { ids: next }; })
}));

export function archiveCandidates(photos: readonly PhotoView[], now = Date.now()): PhotoView[] {
  const archived = useArchive.getState().ids;
  return photos.filter(p =>
    !archived.has(p.id) &&
    p.status !== 'selected' &&
    !p.aside &&
    !p.edits &&
    p.personNames.length === 0 &&
    !(p.petNames?.length) &&
    p.aiScore < ARCHIVE_SCORE &&
    photoTime(p) < now - YEAR
  );
}

export function autoArchiveOn(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}
export function setAutoArchive(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* fără stocare */ }
}

/** Arhivează acum ce se potrivește; întoarce câte au plecat. */
export function archiveNow(photos: readonly PhotoView[]): number {
  const list = archiveCandidates(photos);
  if (list.length) useArchive.getState().add(list.map(p => p.id));
  try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* fără stocare */ }
  return list.length;
}

/** O dată pe săptămână, dacă omul a pornit arhivarea automată. */
export function autoArchiveIfDue(photos: readonly PhotoView[]): number {
  if (!autoArchiveOn()) return 0;
  try { if (Date.now() - Number(localStorage.getItem(LAST_KEY) || 0) < WEEK) return 0; } catch { /* fără stocare */ }
  return archiveNow(photos);
}
