/**
 * lumin/shareCards.ts
 * Carduri de partajare desenate pe telefon. Nimic nu e urcat pe un server:
 * fișierul pleacă doar dacă omul îl trimite din foaia sistemului.
 *
 * Pătrat 1080 și poveste 9:16. Semnătura e discretă; linkul e fișa Play.
 */
import { shareCollage } from './collage';

export const CARD = 1080;
export const STORY_W = 1080;
export const STORY_H = 1920;
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.luminculler.app';

export function shareCaption(line: string, cta: string): string {
  return `${line}\n${cta}\n${PLAY_URL}`;
}

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  return ctx ? { c, ctx } : null;
}

function blobOf(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}

function paintBrand(ctx: CanvasRenderingContext2D, w: number, h: number, cta: string): void {
  ctx.fillStyle = 'rgba(5,3,5,0.55)';
  ctx.fillRect(0, h - 120, w, 120);
  ctx.fillStyle = '#fff6f9';
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Cherrypic', 48, h - 78);
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillStyle = '#ffd0dc';
  ctx.fillText(cta, 48, h - 36);
}

/** Spațiul eliberat. Fără chipuri: doar cifrele reale primite de apelant. */
export async function renderFreedCard(size: string, detail: string, cta: string, story = false): Promise<Blob | null> {
  const w = story ? STORY_W : CARD;
  const h = story ? STORY_H : CARD;
  const box = canvas(w, h);
  if (!box) return null;
  const { c, ctx } = box;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1a0a12');
  g.addColorStop(1, '#050305');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff4f7f';
  ctx.fillRect(0, 0, w, 12);
  ctx.fillStyle = '#fff6f9';
  ctx.font = '700 92px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(size, 72, h * 0.32);
  ctx.font = '500 36px system-ui, sans-serif';
  ctx.fillStyle = '#e7d5dc';
  wrap(ctx, detail, 72, h * 0.32 + 120, w - 144, 48);
  paintBrand(ctx, w, h, cta);
  return blobOf(c);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number): void {
  const words = text.split(' ');
  let row = '';
  let yy = y;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (ctx.measureText(next).width > max && row) {
      ctx.fillText(row, x, yy);
      row = word;
      yy += line;
    } else row = next;
  }
  if (row) ctx.fillText(row, x, yy);
}

async function loadImg(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try { await img.decode(); return img; } catch { return null; }
}

/** Înainte / după, una lângă alta, cu ce s-a reparat (lista primită, nu inventată). */
export async function renderBeforeAfterCard(beforeSrc: string, afterSrc: string, fixes: string, cta: string): Promise<Blob | null> {
  const [a, b] = await Promise.all([loadImg(beforeSrc), loadImg(afterSrc)]);
  if (!a || !b) return null;
  const box = canvas(CARD, CARD);
  if (!box) return null;
  const { c, ctx } = box;
  ctx.fillStyle = '#050305';
  ctx.fillRect(0, 0, CARD, CARD);
  const half = (CARD - 8) / 2;
  cover(ctx, a, 0, 0, half, CARD - 260);
  cover(ctx, b, half + 8, 0, half, CARD - 260);
  ctx.fillStyle = '#fff6f9';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  wrap(ctx, fixes, 36, CARD - 248, CARD - 72, 32);
  paintBrand(ctx, CARD, CARD, cta);
  return blobOf(c);
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

export async function shareCard(blob: Blob, name: string, line: string, cta: string): Promise<void> {
  await shareCollage(blob, name, shareCaption(line, cta));
}
