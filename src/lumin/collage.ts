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

async function loadImage(id: string): Promise<HTMLImageElement | null> {
  const url = (await getDisplayUrl(id).catch(() => null)) ?? (await getCachedThumbUrl(id).catch(() => null));
  if (!url) return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try { await img.decode(); return img; } catch { return null; }
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number): void {
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
  ctx.fillText('Lumin AI', pad, H - 50);
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
