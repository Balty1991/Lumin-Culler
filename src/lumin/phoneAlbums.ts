import { canCopyAlbumOnDevice, copyAlbumToPictures } from '../core/albumExport';
import { useStore, type PhotoView } from '../state/store';
import { t } from '../i18n';
import { monthLabel } from './format';
import { photoTime } from './days';

/**
 * lumin/phoneAlbums.ts
 * Ordonarea galeriei telefonului: pozele păstrate se COPIAZĂ în albume reale,
 * Pictures/Lumin/<album>, vizibile în orice galerie (și în Google Photos).
 * Originalele nu se mută. Ce s-a copiat o dată nu se mai copiază a doua oară.
 */
const DONE_KEY = 'lumin-phone-albums';

function readDone(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? '{}'); } catch { return {}; }
}
function writeDone(v: Record<string, string[]>): void {
  try { localStorage.setItem(DONE_KEY, JSON.stringify(v)); } catch { /* fără stocare */ }
}

export const canMakePhoneAlbums = canCopyAlbumOnDevice;

export async function copyToPhoneAlbum(album: string, photos: readonly PhotoView[]): Promise<number> {
  const done = readDone();
  const already = new Set(done[album] ?? []);
  const todo = photos.filter(p => p.mediaUri && !already.has(p.id));
  const locale = useStore.getState().locale;
  if (!todo.length) {
    useStore.getState().setNotice(t(locale, 'lx.phone.nothing', { album }));
    return 0;
  }
  useStore.getState().setNotice(t(locale, 'lx.phone.copying', { count: todo.length, album }));
  const r = await copyAlbumToPictures(album, todo.map(p => ({ uri: p.mediaUri!, name: p.fileName })));
  done[album] = [...already, ...todo.map(p => p.id)];
  writeDone(done);
  useStore.getState().setNotice(t(locale, 'lx.phone.copied', { count: r.copied, album }));
  return r.copied;
}

/** Toate pozele păstrate, câte un album pe lună: „Lumin · Octombrie 2026”. */
export async function organizeKeptByMonth(): Promise<number> {
  const { photos, locale } = useStore.getState();
  const byMonth = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (p.status !== 'selected' || p.aside) continue;
    const d = new Date(photoTime(p));
    const name = monthLabel(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), locale);
    const list = byMonth.get(name) ?? [];
    list.push(p);
    byMonth.set(name, list);
  }
  let total = 0;
  for (const [name, list] of byMonth) total += await copyToPhoneAlbum(name, list);
  useStore.getState().setNotice(t(locale, 'lx.phone.organized', { count: total, albums: byMonth.size }));
  return total;
}

/** Câte un album pe om, cu pozele păstrate în care apare: „Angi”, „Alin”. */
export async function organizeKeptByPeople(): Promise<number> {
  const { photos, locale } = useStore.getState();
  const byPerson = new Map<string, PhotoView[]>();
  for (const p of photos) {
    if (p.status !== 'selected' || p.aside) continue;
    for (const n of p.personNames) {
      const list = byPerson.get(n) ?? [];
      list.push(p);
      byPerson.set(n, list);
    }
  }
  let total = 0;
  for (const [name, list] of byPerson) total += await copyToPhoneAlbum(name, list);
  useStore.getState().setNotice(t(locale, 'lx.phone.organized', { count: total, albums: byPerson.size }));
  return total;
}
