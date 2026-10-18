/**
 * ui/shareResultCard.ts
 * Cartonașul de după o curățare: o imagine, nu un text, cu linkul de Play.
 *
 * Se desenează pe telefon. Nu se trimite nicăieri de la noi — foaia de
 * partajare a sistemului o primește omul, la fel ca la exportul de poze.
 */
import { t, type Locale } from '../i18n';
import { downloadBlob } from '../core/export/directoryPicker';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.luminculler.app';

export interface ShareCardCopy {
  kicker: string;
  size: string;
  brand: string;
  detail: string;
  link: string;
}

export function shareCardCopy(locale: Locale, size: string, count: number): ShareCardCopy {
  return {
    kicker: t(locale, 'clean.share.kicker'),
    size,
    brand: t(locale, 'clean.share.with'),
    detail: t(locale, 'clean.share.files', { count }),
    link: PLAY_STORE_URL.replace('https://', '')
  };
}

export function paintShareCard(ctx: CanvasRenderingContext2D, copy: ShareCardCopy, width = 1080, height = 1350): void {
  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#120814');
  bg.addColorStop(1, '#05060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glowA = ctx.createRadialGradient(180, 160, 20, 180, 160, 520);
  glowA.addColorStop(0, 'rgba(255, 77, 154, 0.5)');
  glowA.addColorStop(1, 'rgba(255, 77, 154, 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, width, height);

  const glowB = ctx.createRadialGradient(920, 1180, 20, 920, 1180, 560);
  glowB.addColorStop(0, 'rgba(61, 255, 242, 0.32)');
  glowB.addColorStop(1, 'rgba(61, 255, 242, 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  roundRect(ctx, 64, 64, width - 128, height - 128, 48);
  ctx.stroke();

  ctx.fillStyle = '#9ee7f5';
  ctx.font = '600 28px "Space Grotesk", sans-serif';
  ctx.fillText('LUMIN', 120, 180);

  ctx.fillStyle = '#c5cad6';
  ctx.font = '500 42px "Space Grotesk", sans-serif';
  ctx.fillText(copy.kicker, 120, 520);

  const gradient = ctx.createLinearGradient(120, 560, 900, 760);
  gradient.addColorStop(0, '#ff4d9a');
  gradient.addColorStop(0.55, '#ffffff');
  gradient.addColorStop(1, '#3dfff2');
  ctx.fillStyle = gradient;
  ctx.font = '700 132px "Space Grotesk", sans-serif';
  ctx.fillText(copy.size, 120, 690);

  ctx.fillStyle = '#f4f6fb';
  ctx.font = '600 54px "Space Grotesk", sans-serif';
  ctx.fillText(copy.brand, 120, 790);

  ctx.fillStyle = '#a3a7b3';
  ctx.font = '500 36px "Space Grotesk", sans-serif';
  ctx.fillText(copy.detail, 120, 870);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, 120, 1080, width - 240, 120, 28);
  ctx.fill();
  ctx.fillStyle = '#d7fbff';
  ctx.font = '600 28px "Space Grotesk", sans-serif';
  ctx.fillText(copy.link, 156, 1152);
}

async function renderBlob(copy: ShareCardCopy): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* fontul de sistem e de ajuns */ }
  }
  paintShareCard(ctx, copy, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png');
  return blob;
}

/** Deschide foaia de partajare cu imaginea. Pe web, unde nu există foaie, descarcă PNG-ul. */
export async function shareCleanResult(locale: Locale, size: string, count: number): Promise<void> {
  const copy = shareCardCopy(locale, size, count);
  try {
    const blob = await renderBlob(copy);
    const saved = await downloadBlob('lumin-freed.png', blob);
    if (!saved.cancelled) return;
  } catch {
    // Foaia n-a putut primi imaginea. Textul rămâne, ca gestul să nu se piardă.
  }
  const text = `${copy.kicker} ${copy.size} ${copy.brand}. ${copy.detail}. ${PLAY_STORE_URL}`;
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ text, url: PLAY_STORE_URL }); return; } catch { /* anulare */ }
  }
  try { await navigator.clipboard.writeText(text); } catch { /* fără clipboard */ }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
