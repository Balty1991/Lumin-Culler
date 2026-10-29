import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getDisplayUrl } from '../core/previewUrlCache';
import { getCachedThumbUrl } from '../core/thumbUrlCache';

/**
 * lumin/collage.ts
 * „Săptămâna ta în 7 poze” și „Anul tău în poze”: un colaj vertical
 * (1080×1350, formatul care arată bine pe Instagram și WhatsApp), făcut pe
 * telefon din pozele păstrate, gata de trimis. Nimic nu pleacă singur.
 */
const W = 1080;
const H = 1350;

export async function loadImage(id: string): Promise<HTMLImageElement | null> {
  const url = (await getDisplayUrl(id).catch(() => null)) ?? (await getCachedThumbUrl(id).catch(() => null));
  if (!url) return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try { await img.decode(); return img; } catch { return null; }
}

export function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number): void {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Prima poză mare sus, restul pe două rânduri dedesubt. */
export async function makeCollage(ids: string[], title: string, subtitle: string): Promise<Blob | null> {
  const images = (await Promise.all(ids.slice(0, 7).map(loadImage))).filter((x): x is HTMLImageElement => !!x);
  if (!images.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0d1a');
  bg.addColorStop(1, '#06070a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 60, 10, W * 0.85, 60, 600);
  glow.addColorStop(0, 'rgba(155,140,255,0.35)');
  glow.addColorStop(1, 'rgba(155,140,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const pad = 48;
  const gap = 16;
  ctx.fillStyle = '#eef1f6';
  ctx.font = '600 64px "Sora Variable", "Inter Variable", sans-serif';
  ctx.fillText(title, pad, 120);
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '400 34px "Inter Variable", sans-serif';
  ctx.fillText(subtitle, pad, 172);

  const top = 214;
  const bottom = H - 110;
  const [first, ...rest] = images;
  const heroH = rest.length ? Math.round((bottom - top) * 0.56) : bottom - top;
  cover(ctx, first, pad, top, W - pad * 2, heroH, 36);
  if (rest.length) {
    const rows = rest.length > 3 ? 2 : 1;
    const perRow = Math.ceil(rest.length / rows);
    const rowH = (bottom - top - heroH - gap * rows) / rows;
    rest.forEach((img, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? rest.length - perRow * (rows - 1) : perRow;
      const col = i % perRow;
      const cw = (W - pad * 2 - gap * (inRow - 1)) / inRow;
      cover(ctx, img, pad + col * (cw + gap), top + heroH + gap + row * (rowH + gap), cw, rowH, 28);
    });
  }

  const brand = ctx.createLinearGradient(pad, 0, pad + 260, 0);
  brand.addColorStop(0, '#5ee6ff');
  brand.addColorStop(1, '#9b8cff');
  ctx.fillStyle = brand;
  ctx.font = '600 30px "Sora Variable", sans-serif';
  ctx.fillText('Cherrypic', pad, H - 50);
  ctx.fillStyle = '#8a93a3';
  ctx.font = '400 26px "Inter Variable", sans-serif';
  const tag = 'ales de AI-ul meu';
  ctx.fillText(tag, W - pad - ctx.measureText(tag).width, H - 50);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Trimite colajul (foaia de partajare a telefonului) sau îl descarcă, pe web. */
export async function shareCollage(blob: Blob, name: string, text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({ path: name, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
    try {
      await Share.share({ files: [written.uri], text, title: name });
    } catch (err) {
      if (!(err instanceof Error && /cancel/i.test(err.message))) throw err;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Colajele cu modele: „grilă” (2–6 poze), „polaroid” (poze cu ramă albă, ușor
 * rotite, pe fundal crem) și „pereche” (două poze alăturate, cu câte o
 * etichetă: „acum un an” / „azi”). Toate 1080×1350, gata de trimis.
 */
export type CollageLayout = 'grid' | 'polaroid' | 'pair';

export async function makeLayoutCollage(
  ids: string[], layout: CollageLayout, title: string, subtitle: string, labels: [string, string] = ['', '']
): Promise<Blob | null> {
  const max = layout === 'pair' ? 2 : layout === 'polaroid' ? 4 : 6;
  const images = (await Promise.all(ids.slice(0, max).map(loadImage))).filter((x): x is HTMLImageElement => !!x);
  if (!images.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const light = layout === 'polaroid';
  ctx.fillStyle = light ? '#f4efe6' : '#0b0d1a';
  ctx.fillRect(0, 0, W, H);
  const pad = 56;
  ctx.fillStyle = light ? '#2b2620' : '#eef1f6';
  ctx.font = '600 60px "Sora Variable", "Inter Variable", sans-serif';
  ctx.fillText(title, pad, 118, W - pad * 2);
  ctx.fillStyle = light ? '#7b7063' : '#9aa3b2';
  ctx.font = '400 32px "Inter Variable", sans-serif';
  ctx.fillText(subtitle, pad, 166, W - pad * 2);
  const top = 206, bottom = H - 110, gap = 14;

  if (layout === 'pair') {
    const cw = (W - pad * 2 - gap) / 2;
    images.forEach((img, i) => {
      const x = pad + i * (cw + gap);
      cover(ctx, img, x, top, cw, bottom - top - 60, 28);
      ctx.fillStyle = '#eef1f6';
      ctx.font = '600 34px "Sora Variable", sans-serif';
      const label = labels[i] ?? '';
      ctx.fillText(label, x + (cw - ctx.measureText(label).width) / 2, bottom - 14);
    });
  } else if (layout === 'polaroid') {
    const spots = [[0.27, 0.36, -5], [0.73, 0.33, 4], [0.3, 0.73, 3], [0.71, 0.72, -4]] as const;
    images.forEach((img, i) => {
      const [fx, fy, deg] = spots[i];
      const fw = 430, fh = 500, photo = 390;
      ctx.save();
      ctx.translate(W * fx, top + (bottom - top) * (fy - 0.15) + 120);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
      ctx.shadowColor = 'transparent';
      cover(ctx, img, -photo / 2, -fh / 2 + 20, photo, photo, 2);
      ctx.restore();
    });
  } else {
    const n = images.length;
    const cols = n <= 2 ? n : n === 3 ? 2 : n === 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cellW = (W - pad * 2 - gap * (cols - 1)) / cols;
    const cellH = (bottom - top - gap * (rows - 1)) / rows;
    images.forEach((img, i) => {
      // Cu 3 poze: prima, mare, pe toată înălțimea din stânga.
      if (n === 3) {
        const big = i === 0;
        const x = big ? pad : pad + cellW + gap;
        const y = big ? top : top + (i - 1) * ((bottom - top - gap) / 2 + gap);
        cover(ctx, img, x, y, cellW, big ? bottom - top : (bottom - top - gap) / 2, 24);
        return;
      }
      const r = Math.floor(i / cols), c = i % cols;
      cover(ctx, img, pad + c * (cellW + gap), top + r * (cellH + gap), cellW, cellH, 24);
    });
  }

  ctx.fillStyle = light ? '#b0243e' : '#9b8cff';
  ctx.font = '600 30px "Sora Variable", sans-serif';
  ctx.fillText('Cherrypic', pad, H - 50);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}
