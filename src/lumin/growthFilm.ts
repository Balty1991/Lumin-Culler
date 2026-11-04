import { db } from '../core/db';
import { weakDevice } from '../core/deviceClass';
import type { PhotoView } from '../state/store';
import { loadEditable } from './sharp';
import { filmFromKeyframes, type BurstFilm, type FilmOptions } from './burstFilm';

/**
 * lumin/growthFilm.ts
 * „Cum a crescut”: câte o poză pe lună cu fața unui om, toate aliniate (aceeași
 * mărime și loc în cadru), apoi trecerile AI dintre ele. Fața „crește” sub ochii
 * tăi, de la cea mai veche poză până azi. Pe telefon, fără server.
 */
export interface GrowthPick { id: string; at: number; box: [number, number, number, number] }

/** Cea mai bună față a omului din fiecare lună (mare, cu ochii deschiși), cel mult `max`. */
export async function pickGrowthFaces(name: string, photos: readonly PhotoView[], max = 16): Promise<GrowthPick[]> {
  const withTime = photos.filter(p => p.capturedAt !== undefined && !p.aside);
  const analyses = await db.analyses.bulkGet(withTime.map(p => p.id));
  const byMonth = new Map<number, { pick: GrowthPick; score: number }>();
  withTime.forEach((p, i) => {
    const a = analyses[i];
    const face = a?.faces.find(f => f.personName === name);
    if (!face) return;
    const [, , bw, bh] = face.box;
    const open = (face.eyesOpen.left + face.eyesOpen.right) / 2;
    // Fețe mari, din față (casetă cam pătrată), cu ochii deschiși; păstrate de om, un pic în plus.
    const square = 1 - Math.min(1, Math.abs(bw / Math.max(bh, 1e-6) - 0.8));
    const score = Math.sqrt(bw * bh) * 4 + open + square * 0.6 + (face.faceScore ?? 0) * 0.5 + (p.status === 'selected' ? 0.3 : 0);
    const d = new Date(p.capturedAt!);
    const key = d.getFullYear() * 12 + d.getMonth();
    const cur = byMonth.get(key);
    if (!cur || score > cur.score) byMonth.set(key, { pick: { id: p.id, at: p.capturedAt!, box: face.box }, score });
  });
  const months = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.pick);
  if (months.length <= max) return months;
  // Prea multe luni: păstrăm prima, ultima și pași egali între ele.
  const out: GrowthPick[] = [];
  for (let i = 0; i < max; i++) out.push(months[Math.round(i * (months.length - 1) / (max - 1))]);
  return out;
}

/** Cadrul: fața la aceeași mărime, sus-mijloc; pe margini, aceeași poză estompată. */
function alignedFrame(img: HTMLImageElement, box: [number, number, number, number], S: number, caption: string, sub: string | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0508'; ctx.fillRect(0, 0, S, S);
  const W = img.naturalWidth, H = img.naturalHeight;
  // Fundalul: toată poza, estompată, ca marginile să nu fie negre.
  ctx.save();
  ctx.filter = 'blur(28px) brightness(0.55)';
  const kb = Math.max(S / W, S / H) * 1.1;
  ctx.drawImage(img, (S - W * kb) / 2, (S - H * kb) / 2, W * kb, H * kb);
  ctx.restore();
  const [bx, by, bw, bh] = box;
  const face = Math.max(bw * W, bh * H);
  const k = (S * 0.34) / Math.max(face, 1);
  const cx = (bx + bw / 2) * W, cy = (by + bh / 2) * H;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, S * 0.5 - cx * k, S * 0.42 - cy * k, W * k, H * k);
  // Eticheta: luna și, dacă știm ziua de naștere, vârsta.
  const g = ctx.createLinearGradient(0, S * 0.7, 0, S);
  g.addColorStop(0, 'rgba(5,3,5,0)'); g.addColorStop(1, 'rgba(5,3,5,0.82)');
  ctx.fillStyle = g; ctx.fillRect(0, S * 0.7, S, S * 0.3);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff6f9';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = S * 0.02;
  ctx.font = `700 ${Math.round(S * 0.055)}px system-ui, sans-serif`;
  ctx.fillText(caption, S / 2, S * (sub ? 0.875 : 0.92));
  if (sub) {
    ctx.fillStyle = '#ff8fae';
    ctx.font = `600 ${Math.round(S * 0.04)}px system-ui, sans-serif`;
    ctx.fillText(sub, S / 2, S * 0.935);
  }
  return c;
}

export async function makeGrowthFilm(
  picks: GrowthPick[],
  label: (at: number) => { caption: string; sub: string | null },
  opts: FilmOptions = {},
  onProgress?: (f: number) => void
): Promise<BurstFilm | null> {
  if (picks.length < 2) return null;
  const S = (await weakDevice()) ? 600 : 720;
  const frames: HTMLCanvasElement[] = [];
  for (const p of picks) {
    const r = await loadEditable(p.id, 1600).catch(() => null);
    if (r?.img) {
      const l = label(p.at);
      frames.push(alignedFrame(r.img, p.box, S, l.caption, l.sub));
    }
    onProgress?.(0.1 * frames.length / picks.length);
  }
  if (frames.length < 2) return null;
  return filmFromKeyframes(frames, { speed: 'slow', transition: 'ai', loop: 'forward', music: 'calm', ...opts }, f => onProgress?.(0.1 + f * 0.9));
}
