/**
 * lumin/shareCards.ts
 * Carduri de partajare desenate pe telefon. Nimic nu e urcat pe un server:
 * fișierul pleacă doar dacă omul îl trimite din foaia sistemului.
 *
 * Pătrat 1080 și poveste 9:16. Semnătura e discretă; linkul e fișa Play.
 */
import { isPremium } from '../core/entitlement';
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
  // Pro: fără semnătura Cherrypic pe ce trimiți (promis în ofertă).
  if (isPremium()) return;
  const bar = ctx.createLinearGradient(0, h - 132, 0, h);
  bar.addColorStop(0, 'rgba(7,9,16,0)');
  bar.addColorStop(1, 'rgba(7,9,16,0.82)');
  ctx.fillStyle = bar;
  ctx.fillRect(0, h - 132, w, 132);
  ctx.fillStyle = '#f4f7fb';
  ctx.font = '600 36px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Cherrypic', 48, h - 78);
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillStyle = '#d7c6ff';
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
  g.addColorStop(0, '#1a1030');
  g.addColorStop(0.55, '#120818');
  g.addColorStop(1, '#070910');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, '#ff4d8d');
  edge.addColorStop(0.5, '#b06bff');
  edge.addColorStop(1, '#5ce1ff');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, 14);
  ctx.fillStyle = '#f4f7fb';
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

/**
 * „Ziua mea în 3 poze”: cardul de trimis după ritual. O poză mare și două mici (sau
 * mai puține, câte sunt), data și semnătura discretă.
 */
export async function renderDayCard(srcs: readonly string[], title: string, date: string, cta: string): Promise<Blob | null> {
  const imgs = (await Promise.all(srcs.slice(0, 3).map(loadImg))).filter((i): i is HTMLImageElement => !!i);
  if (!imgs.length) return null;
  const box = canvas(STORY_W, STORY_H);
  if (!box) return null;
  const { c, ctx } = box;
  ctx.fillStyle = '#07060a';
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const pad = 48, gap = 14, top = 250, bottom = STORY_H - 190;
  const w = STORY_W - pad * 2, h = bottom - top;
  const tile = (img: HTMLImageElement, x: number, y: number, tw: number, th: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, tw, th, 44);
    ctx.clip();
    cover(ctx, img, x, y, tw, th);
    ctx.restore();
  };
  if (imgs.length === 1) tile(imgs[0], pad, top, w, h);
  else if (imgs.length === 2) { const th = (h - gap) / 2; tile(imgs[0], pad, top, w, th); tile(imgs[1], pad, top + th + gap, w, th); }
  else {
    const big = Math.round(h * 0.62), small = h - big - gap, half = (w - gap) / 2;
    tile(imgs[0], pad, top, w, big);
    tile(imgs[1], pad, top + big + gap, half, small);
    tile(imgs[2], pad + half + gap, top + big + gap, half, small);
  }
  ctx.fillStyle = '#fff6f9';
  ctx.textBaseline = 'top';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText(title, pad, 92);
  ctx.fillStyle = 'rgba(255, 246, 249, 0.62)';
  ctx.font = '500 32px system-ui, sans-serif';
  ctx.fillText(date, pad, 176);
  paintBrand(ctx, STORY_W, STORY_H, cta);
  return blobOf(c);
}

/**
 * „Anul meu în poze”: cardul vertical de sfârșit de an. Anul mare, trei cadre din
 * luni diferite și cifrele omului, câte una pe rând.
 */
export async function renderYearCard(srcs: readonly string[], year: number, title: string, lines: readonly string[], cta: string): Promise<Blob | null> {
  const imgs = (await Promise.all(srcs.slice(0, 3).map(loadImg))).filter((i): i is HTMLImageElement => !!i);
  if (!imgs.length) return null;
  const box = canvas(STORY_W, STORY_H);
  if (!box) return null;
  const { c, ctx } = box;
  const bg = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
  bg.addColorStop(0, '#1b0b1d'); bg.addColorStop(0.55, '#07060a'); bg.addColorStop(1, '#0a1220');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const pad = 56, gap = 14;
  ctx.textBaseline = 'top';
  const grad = ctx.createLinearGradient(pad, 0, pad + 520, 0);
  grad.addColorStop(0, '#ff5482'); grad.addColorStop(0.6, '#b56bff'); grad.addColorStop(1, '#6fd3ff');
  ctx.fillStyle = grad;
  ctx.font = '800 220px system-ui, sans-serif';
  ctx.fillText(String(year), pad - 8, 70);
  ctx.fillStyle = '#fff6f9';
  ctx.font = '700 54px system-ui, sans-serif';
  ctx.fillText(title, pad, 310);
  const top = 420, w = STORY_W - pad * 2, big = 620, small = 330, half = (w - gap) / 2;
  const tile = (img: HTMLImageElement, x: number, y: number, tw: number, th: number) => {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, tw, th, 40); ctx.clip(); cover(ctx, img, x, y, tw, th); ctx.restore();
  };
  tile(imgs[0], pad, top, w, imgs.length === 1 ? big + gap + small : big);
  if (imgs.length === 2) tile(imgs[1], pad, top + big + gap, w, small);
  if (imgs.length >= 3) { tile(imgs[1], pad, top + big + gap, half, small); tile(imgs[2], pad + half + gap, top + big + gap, half, small); }
  let y = top + big + gap + small + 48;
  ctx.fillStyle = 'rgba(255, 246, 249, 0.9)';
  ctx.font = '500 38px system-ui, sans-serif';
  for (const line of lines.slice(0, 4)) { ctx.fillText(line, pad, y); y += 58; }
  paintBrand(ctx, STORY_W, STORY_H, cta);
  return blobOf(c);
}
