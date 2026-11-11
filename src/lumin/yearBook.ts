import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { PhotoView } from '../state/store';
import { blobToBase64, cover, loadImage } from './collage';
import { photoTime } from './days';
import { bestSpread } from './momentAlbums';
import { makePdf, type PdfPage } from './pdf';

/**
 * lumin/yearBook.ts
 * „Cartea anului”: un PDF A4, gata de printat sau de trimis — coperta cu cea
 * mai frumoasă poză a anului, apoi câte o pagină pe lună cu cele mai bune
 * patru poze păstrate (din tot intervalul lunii). Totul se face pe telefon.
 */
const PW = 1240, PH = 1754;

/** Cu oameni întâi (cerut: „de preferat cu persoane”), apoi după scor. */
function peopleFirst(list: readonly PhotoView[]): PhotoView[] {
  const has = (p: PhotoView) => (p.personNames.length > 0 || (p.faceCount ?? 0) > 0 ? 1 : 0);
  return [...list].sort((a, b) => has(b) - has(a) || b.aiScore - a.aiScore);
}

/**
 * Lunile fără nicio poză păstrată: cartea anului și calendarul se propun doar
 * când fiecare lună are poza ei; altfel rămân ca opțiune „Generează oricum”.
 * Cartea: lunile anului până acum. Calendarul: luna din anul ales sau, dacă
 * acolo lipsește (ex. noiembrie încă n-a venit), aceeași lună din anul dinainte.
 */
export function missingMonths(kind: 'book' | 'calendar', year: number, kept: readonly PhotoView[], now = new Date()): number[] {
  const have = new Set<string>();
  for (const p of kept) { const d = new Date(photoTime(p)); have.add(`${d.getFullYear()}-${d.getMonth()}`); }
  const last = kind === 'book' && year === now.getFullYear() ? now.getMonth() : 11;
  const out: number[] = [];
  for (let m = 0; m <= last; m++) {
    const ok = have.has(`${year}-${m}`) || (kind === 'calendar' && have.has(`${year - 1}-${m}`));
    if (!ok) out.push(m);
  }
  return out;
}

async function pageJpeg(draw: (ctx: CanvasRenderingContext2D) => Promise<void>): Promise<PdfPage | null> {
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f6f1e9';
  ctx.fillRect(0, 0, PW, PH);
  await draw(ctx);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9));
  return blob ? { jpeg: new Uint8Array(await blob.arrayBuffer()), width: PW, height: PH } : null;
}

export async function makeYearBook(year: number, kept: readonly PhotoView[], texts: { title: string; subtitle: string; month: (m: number) => string }, onProgress?: (done: number, total: number) => void): Promise<Blob | null> {
  const inYear = kept.filter(p => new Date(photoTime(p)).getFullYear() === year);
  if (inYear.length < 4) return null;
  const months = new Map<number, PhotoView[]>();
  for (const p of inYear) {
    const m = new Date(photoTime(p)).getMonth();
    months.set(m, [...(months.get(m) ?? []), p]);
  }
  const order = [...months.keys()].sort((a, b) => a - b);
  const total = order.length + 1;
  const pages: PdfPage[] = [];

  const coverPhoto = [...inYear].sort((a, b) => b.aiScore - a.aiScore)[0];
  const first = await pageJpeg(async ctx => {
    const img = await loadImage(coverPhoto.id);
    if (img) cover(ctx, img, 90, 90, PW - 180, PH * 0.68, 18);
    ctx.fillStyle = '#2b2620';
    ctx.font = '700 150px Georgia, serif';
    ctx.fillText(String(year), 90, PH * 0.68 + 260);
    ctx.font = '400 54px Georgia, serif';
    ctx.fillStyle = '#6b6156';
    ctx.fillText(texts.title, 90, PH * 0.68 + 350, PW - 180);
    ctx.font = '400 34px Georgia, serif';
    ctx.fillText(texts.subtitle, 90, PH * 0.68 + 410, PW - 180);
  });
  if (first) pages.push(first);
  onProgress?.(1, total);

  for (const [i, m] of order.entries()) {
    const all = months.get(m)!;
    const withPeople = all.filter(p => p.personNames.length > 0 || (p.faceCount ?? 0) > 0);
    const picks = peopleFirst(withPeople.length >= 4 ? bestSpread(withPeople, 4) : [...bestSpread(withPeople, 4), ...bestSpread(all.filter(p => !withPeople.includes(p)), 4 - withPeople.length)]);
    const page = await pageJpeg(async ctx => {
      ctx.fillStyle = '#2b2620';
      ctx.font = '600 72px Georgia, serif';
      ctx.fillText(texts.month(m), 90, 170);
      const imgs = (await Promise.all(picks.map(p => loadImage(p.id)))).filter((x): x is HTMLImageElement => !!x);
      const top = 240, gap = 30, w = (PW - 180 - gap) / 2, h = (PH - top - 130 - gap) / 2;
      imgs.forEach((img, k) => {
        if (imgs.length === 1) { cover(ctx, img, 90, top, PW - 180, PH - top - 130, 12); return; }
        const x = 90 + (k % 2) * (w + gap), y = top + Math.floor(k / 2) * (h + gap);
        cover(ctx, img, x, y, w, imgs.length === 3 && k === 2 ? h : h, 12);
      });
      ctx.fillStyle = '#9a8f82';
      ctx.font = '400 26px Georgia, serif';
      ctx.fillText(`${i + 2}`, PW / 2 - 8, PH - 60);
    });
    if (page) pages.push(page);
    onProgress?.(i + 2, total);
  }
  return new Blob([makePdf(pages) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

export async function shareYearBook(blob: Blob, name: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache });
    try { await Share.share({ files: [written.uri], title: name }); } catch { /* închisă */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/**
 * Calendarul foto: anul care vine, câte o lună pe pagină A4, cu cea mai bună
 * poză din aceeași lună a anului trecut (ianuarie cu un ianuarie de-al vostru),
 * iar unde luna n-are poze, una dintre cele mai bune ale anului.
 */
export async function makeCalendar(
  year: number, kept: readonly PhotoView[],
  texts: { title: string; month: (m: number) => string; weekdays: string[] },
  onProgress?: (done: number, total: number) => void
): Promise<Blob | null> {
  const source = kept.filter(p => { const y = new Date(photoTime(p)).getFullYear(); return y === year - 1 || y === year - 2; });
  const pool = source.length >= 6 ? source : kept;
  if (pool.length < 6) return null;
  const byScore = [...pool].sort((a, b) => b.aiScore - a.aiScore);
  const used = new Set<string>();
  const pages: PdfPage[] = [];
  const coverPage = await pageJpeg(async ctx => {
    const imgs = (await Promise.all(byScore.slice(0, 4).map(p => loadImage(p.id)))).filter((x): x is HTMLImageElement => !!x);
    const w = (PW - 180 - 30) / 2, h = (PH * 0.62 - 30) / 2;
    imgs.forEach((img, k) => cover(ctx, img, 90 + (k % 2) * (w + 30), 90 + Math.floor(k / 2) * (h + 30), w, h, 12));
    ctx.fillStyle = '#2b2620';
    ctx.font = '700 170px Georgia, serif';
    ctx.fillText(String(year), 90, PH * 0.62 + 300);
    ctx.font = '400 54px Georgia, serif';
    ctx.fillStyle = '#6b6156';
    ctx.fillText(texts.title, 90, PH * 0.62 + 390, PW - 180);
  });
  if (coverPage) pages.push(coverPage);
  for (let m = 0; m < 12; m++) {
    // Luna anului ales, apoi aceeași lună din anul dinainte; cu oameni întâi.
    const ofMonth = (y: number) => peopleFirst(pool.filter(p => { const d = new Date(photoTime(p)); return d.getMonth() === m && d.getFullYear() === y && !used.has(p.id); }));
    const inMonth = [...ofMonth(year - 1), ...ofMonth(year - 2)];
    const photo = inMonth[0] ?? byScore.find(p => !used.has(p.id)) ?? byScore[m % byScore.length];
    used.add(photo.id);
    const page = await pageJpeg(async ctx => {
      const img = await loadImage(photo.id);
      if (img) cover(ctx, img, 90, 90, PW - 180, PH * 0.52, 14);
      ctx.fillStyle = '#2b2620';
      ctx.font = '600 76px Georgia, serif';
      ctx.fillText(`${texts.month(m)} ${year}`, 90, PH * 0.52 + 200);
      // Grila lunii: luni–duminică.
      const top = PH * 0.52 + 260, cw = (PW - 180) / 7, rh = 92;
      ctx.font = '600 30px Georgia, serif';
      ctx.fillStyle = '#9a8f82';
      texts.weekdays.forEach((d, i) => ctx.fillText(d, 90 + i * cw + 12, top));
      const first = (new Date(year, m, 1).getDay() + 6) % 7;
      const days = new Date(year, m + 1, 0).getDate();
      ctx.font = '400 40px Georgia, serif';
      for (let d = 1; d <= days; d++) {
        const cell = first + d - 1;
        const x = 90 + (cell % 7) * cw + 12, y = top + 70 + Math.floor(cell / 7) * rh;
        ctx.fillStyle = cell % 7 >= 5 ? '#b0243e' : '#2b2620';
        ctx.fillText(String(d), x, y);
      }
    });
    if (page) pages.push(page);
    onProgress?.(m + 2, 13);
  }
  return new Blob([makePdf(pages) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/**
 * Jurnalul unui om (de obicei al copilului): o pagină pe lună, cu cea mai
 * frumoasă poză cu el din luna aceea și vârsta lui atunci. Totul pe telefon.
 */
export async function makeJournal(
  name: string, photos: readonly PhotoView[],
  texts: { title: string; month: (start: number) => string; age: (start: number) => string | null },
  onProgress?: (done: number, total: number) => void
): Promise<Blob | null> {
  const byMonth = new Map<number, PhotoView>();
  const score = (x: PhotoView) => (x.status === 'selected' ? 3 : 0) + (x.aesthetic ?? x.aiScore / 12);
  for (const p of photos) {
    if (p.aside) continue;
    const d = new Date(photoTime(p));
    const k = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const cur = byMonth.get(k);
    if (!cur || score(p) > score(cur)) byMonth.set(k, p);
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  if (months.length < 2) return null;
  const pages: PdfPage[] = [];
  const total = months.length + 1;
  const best = [...byMonth.values()].sort((a, b) => score(b) - score(a))[0];
  const first = await pageJpeg(async ctx => {
    const img = await loadImage(best.id);
    if (img) cover(ctx, img, 90, 90, PW - 180, PH * 0.66, 18);
    ctx.fillStyle = '#2b2620';
    ctx.font = '700 110px Georgia, serif';
    ctx.fillText(texts.title, 90, PH * 0.66 + 230, PW - 180);
    ctx.font = '400 40px Georgia, serif';
    ctx.fillStyle = '#6b6156';
    ctx.fillText(`${texts.month(months[0])} – ${texts.month(months[months.length - 1])}`, 90, PH * 0.66 + 310, PW - 180);
  });
  if (first) pages.push(first);
  onProgress?.(1, total);
  for (const [i, m] of months.entries()) {
    const p = byMonth.get(m)!;
    const page = await pageJpeg(async ctx => {
      const img = await loadImage(p.id);
      if (img) cover(ctx, img, 90, 90, PW - 180, PH - 420, 16);
      ctx.fillStyle = '#2b2620';
      ctx.font = '600 68px Georgia, serif';
      ctx.fillText(texts.month(m), 90, PH - 220, PW - 180);
      const age = texts.age(m);
      if (age) { ctx.font = '400 40px Georgia, serif'; ctx.fillStyle = '#6b6156'; ctx.fillText(age, 90, PH - 150, PW - 180); }
      ctx.fillStyle = '#9a8f82';
      ctx.font = '400 26px Georgia, serif';
      ctx.fillText(`${i + 2}`, PW / 2 - 8, PH - 60);
    });
    if (page) pages.push(page);
    onProgress?.(i + 2, total);
  }
  return new Blob([makePdf(pages) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** Câte poze intră pe paginile unei luni, pe rând: o pagină mare, apoi 3, 4, 2… */
const ALBUM_LAYOUTS = [1, 3, 4, 2];
export const ALBUM_MAX_PAGES = 60;
/** Împarte pozele unei luni pe pagini, după așezările de mai sus (logică pură, testată). */
export function albumPages<T>(photos: readonly T[], perMonth = 12): T[][] {
  const list = photos.slice(0, perMonth);
  const out: T[][] = [];
  let i = 0, k = 0;
  while (i < list.length) {
    let n = ALBUM_LAYOUTS[k % ALBUM_LAYOUTS.length];
    const left = list.length - i;
    if (left - n === 1) n += 1; // nu lăsa o poză singură pe ultima pagină
    out.push(list.slice(i, i + Math.min(n, left)));
    i += n; k++;
  }
  return out;
}

/**
 * „Albumul de familie” (Pro): cartea anului pe larg — până la 12 poze pe lună, pe mai multe
 * pagini cu așezări diferite, gata de trimis la tipografie (A4, PDF). Cartea simplă rămâne gratuită.
 */
export async function makeFamilyAlbum(year: number, kept: readonly PhotoView[], texts: { title: string; subtitle: string; month: (m: number) => string }, onProgress?: (done: number, total: number) => void): Promise<Blob | null> {
  const inYear = kept.filter(p => new Date(photoTime(p)).getFullYear() === year);
  if (inYear.length < 8) return null;
  const months = new Map<number, PhotoView[]>();
  for (const p of inYear) { const m = new Date(photoTime(p)).getMonth(); months.set(m, [...(months.get(m) ?? []), p]); }
  const order = [...months.keys()].sort((a, b) => a - b);
  const plan: { month: number; first: boolean; photos: PhotoView[] }[] = [];
  for (const m of order) {
    const best = peopleFirst(bestSpread(months.get(m)!, 12)).sort((a, b) => photoTime(a) - photoTime(b));
    albumPages(best).forEach((photos, i) => plan.push({ month: m, first: i === 0, photos }));
  }
  const pagesPlan = plan.slice(0, ALBUM_MAX_PAGES - 1);
  const total = pagesPlan.length + 1;
  const pages: PdfPage[] = [];
  const coverPhoto = [...inYear].sort((a, b) => b.aiScore - a.aiScore)[0];
  const first = await pageJpeg(async ctx => {
    const img = await loadImage(coverPhoto.id);
    if (img) cover(ctx, img, 0, 0, PW, PH * 0.72, 0);
    ctx.fillStyle = '#2b2620';
    ctx.font = '700 150px Georgia, serif';
    ctx.fillText(String(year), 90, PH * 0.72 + 220);
    ctx.font = '400 54px Georgia, serif';
    ctx.fillStyle = '#6b6156';
    ctx.fillText(texts.title, 90, PH * 0.72 + 310, PW - 180);
    ctx.font = '400 34px Georgia, serif';
    ctx.fillText(texts.subtitle, 90, PH * 0.72 + 370, PW - 180);
  });
  if (first) pages.push(first);
  onProgress?.(1, total);
  for (const [i, pg] of pagesPlan.entries()) {
    const page = await pageJpeg(async ctx => {
      const top = pg.first ? 240 : 110;
      if (pg.first) { ctx.fillStyle = '#2b2620'; ctx.font = '600 72px Georgia, serif'; ctx.fillText(texts.month(pg.month), 90, 170); }
      const imgs = (await Promise.all(pg.photos.map(p => loadImage(p.id)))).filter((x): x is HTMLImageElement => !!x);
      const gap = 26, W = PW - 180, H = PH - top - 130;
      const n = imgs.length;
      if (n === 1) cover(ctx, imgs[0], 90, top, W, H, 12);
      else if (n === 2) { const h = (H - gap) / 2; imgs.forEach((img, k) => cover(ctx, img, 90, top + k * (h + gap), W, h, 12)); }
      else if (n === 3) { const big = H * 0.6, small = H - big - gap, w = (W - gap) / 2; cover(ctx, imgs[0], 90, top, W, big, 12); cover(ctx, imgs[1], 90, top + big + gap, w, small, 12); cover(ctx, imgs[2], 90 + w + gap, top + big + gap, w, small, 12); }
      else { const cols = 2, rows = Math.ceil(n / cols), w = (W - gap) / cols, h = (H - gap * (rows - 1)) / rows; imgs.forEach((img, k) => cover(ctx, img, 90 + (k % cols) * (w + gap), top + Math.floor(k / cols) * (h + gap), w, h, 12)); }
      ctx.fillStyle = '#9a8f82';
      ctx.font = '400 26px Georgia, serif';
      ctx.fillText(`${i + 2}`, PW / 2 - 8, PH - 60);
    });
    if (page) pages.push(page);
    onProgress?.(i + 2, total);
  }
  return new Blob([makePdf(pages) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
