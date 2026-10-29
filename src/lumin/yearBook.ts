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
    const picks = bestSpread(months.get(m)!, 4);
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
