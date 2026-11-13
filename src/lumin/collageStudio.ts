/**
 * lumin/collageStudio.ts
 * Motorul creatorului de colaje din Studio: șapte modele moderne desenate pe canvas,
 * trei formate, patru fundaluri, spațiere, colțuri, titlu. Totul pe telefon.
 */
export type CollageModel = 'bento' | 'grid' | 'polaroid' | 'film' | 'magazine' | 'heart' | 'stack';
export type CollageFormat = 'portrait' | 'story' | 'square';
export type CollageBg = 'blur' | 'dark' | 'light' | 'color';

export interface CollageOptions {
  model: CollageModel;
  format: CollageFormat;
  bg: CollageBg;
  /** 0..1 */
  gap: number;
  /** 0..1 */
  radius: number;
  title: string;
  subtitle: string;
}

export const COLLAGE_MODELS: CollageModel[] = ['bento', 'grid', 'polaroid', 'film', 'magazine', 'heart', 'stack'];
export const COLLAGE_FORMATS: CollageFormat[] = ['portrait', 'story', 'square'];
export const COLLAGE_BGS: CollageBg[] = ['blur', 'dark', 'light', 'color'];

/** Câte poze folosește fiecare model, cel mult. */
export const MODEL_MAX: Record<CollageModel, number> = { bento: 7, grid: 9, polaroid: 5, film: 4, magazine: 3, heart: 12, stack: 4 };

export function formatSize(f: CollageFormat): { w: number; h: number } {
  return f === 'story' ? { w: 1080, h: 1920 } : f === 'square' ? { w: 1080, h: 1080 } : { w: 1080, h: 1350 };
}

type Img = HTMLImageElement | ImageBitmap;
const iw = (i: Img) => ('naturalWidth' in i ? i.naturalWidth : i.width);
const ih = (i: Img) => ('naturalHeight' in i ? i.naturalHeight : i.height);

function coverDraw(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number, r: number): void {
  const s = Math.max(w / iw(img), h / ih(img));
  const sw = w / s, sh = h / s;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  ctx.clip();
  ctx.drawImage(img, (iw(img) - sw) / 2, (ih(img) - sh) / 2, sw, sh, x, y, w, h);
  ctx.restore();
}

/** Culoarea medie a unei poze (pentru fundalul „Culori”). */
export function averageColor(img: Img): [number, number, number] {
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const x = c.getContext('2d');
    if (!x) return [60, 50, 90];
    x.drawImage(img, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, g / n, b / n];
  } catch { return [60, 50, 90]; }
}

function isLight(o: CollageOptions): boolean { return o.bg === 'light'; }

function background(ctx: CanvasRenderingContext2D, W: number, H: number, imgs: Img[], o: CollageOptions, k: number): void {
  if (o.bg === 'blur' && imgs[0]) {
    ctx.save();
    ctx.filter = `blur(${Math.round(60 * k)}px) brightness(0.55) saturate(1.3)`;
    coverDraw(ctx, imgs[0], -80 * k, -80 * k, W + 160 * k, H + 160 * k, 0);
    ctx.restore();
    ctx.filter = 'none';
    return;
  }
  if (o.bg === 'light') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#faf7f2'); g.addColorStop(1, '#efe9e1');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    return;
  }
  if (o.bg === 'color' && imgs[0]) {
    const [r, g, b] = averageColor(imgs[0]);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `rgb(${r * 0.9 + 30}, ${g * 0.7 + 20}, ${b * 0.9 + 40})`);
    grad.addColorStop(1, `rgb(${r * 0.35}, ${g * 0.3}, ${b * 0.45})`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#12101c'); g.addColorStop(1, '#07070b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.05, 10, W * 0.85, H * 0.05, W * 0.8);
  glow.addColorStop(0, 'rgba(255,79,127,0.28)'); glow.addColorStop(1, 'rgba(255,79,127,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}

function shadow(ctx: CanvasRenderingContext2D, k: number, on: boolean): void {
  ctx.shadowColor = on ? 'rgba(0,0,0,0.35)' : 'transparent';
  ctx.shadowBlur = on ? 30 * k : 0;
  ctx.shadowOffsetY = on ? 12 * k : 0;
}

function titleBlock(ctx: CanvasRenderingContext2D, W: number, y: number, o: CollageOptions, k: number, align: 'left' | 'center' = 'left', size = 64): number {
  if (!o.title && !o.subtitle) return y;
  const pad = 64 * k;
  const ink = isLight(o) ? '#1b1722' : '#ffffff';
  const dim = isLight(o) ? 'rgba(27,23,34,0.6)' : 'rgba(255,255,255,0.72)';
  ctx.textAlign = align;
  const x = align === 'center' ? W / 2 : pad;
  let yy = y;
  if (o.title) {
    ctx.fillStyle = ink;
    ctx.font = `800 ${Math.round(size * k)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    yy += size * k;
    ctx.fillText(o.title, x, yy, W - pad * 2);
  }
  if (o.subtitle) {
    ctx.fillStyle = dim;
    ctx.font = `500 ${Math.round(30 * k)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    yy += 46 * k;
    ctx.fillText(o.subtitle, x, yy, W - pad * 2);
  }
  ctx.textAlign = 'left';
  return yy + 36 * k;
}

function brand(ctx: CanvasRenderingContext2D, W: number, H: number, o: CollageOptions, k: number): void {
  ctx.fillStyle = isLight(o) ? 'rgba(27,23,34,0.45)' : 'rgba(255,255,255,0.55)';
  ctx.font = `600 ${Math.round(22 * k)}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('Cherrypic', W - 40 * k, H - 32 * k);
  ctx.textAlign = 'left';
}

type Rect = [number, number, number, number];

/** Mozaic „bento”: o poză mare și restul în dale de mărimi diferite. */
function bentoRects(n: number, x: number, y: number, w: number, h: number, g: number): Rect[] {
  if (n <= 1) return [[x, y, w, h]];
  if (n === 2) return [[x, y, w, h * 0.6 - g / 2], [x, y + h * 0.6 + g / 2, w, h * 0.4 - g / 2]];
  const topH = h * 0.55;
  const out: Rect[] = [];
  // Sus: mare stânga + 1–2 dreapta.
  const bigW = w * 0.62;
  out.push([x, y, bigW - g / 2, topH - g / 2]);
  const rightN = n >= 5 ? 2 : 1;
  for (let i = 0; i < rightN; i++) {
    const rh = (topH - g / 2 - (rightN - 1) * g) / rightN;
    out.push([x + bigW + g / 2, y + i * (rh + g), w - bigW - g / 2, rh]);
  }
  // Jos: restul, pe 1–2 rânduri.
  const left = n - 1 - rightN;
  if (left <= 0) return out;
  const rows = left > 3 ? 2 : 1;
  const bottomY = y + topH + g / 2;
  const bottomH = h - topH - g / 2;
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.ceil((left - placed) / (rows - r));
    const rh = (bottomH - (rows - 1) * g) / rows;
    const cw = (w - (inRow - 1) * g) / inRow;
    for (let c = 0; c < inRow; c++) out.push([x + c * (cw + g), bottomY + r * (rh + g), cw, rh]);
    placed += inRow;
  }
  return out;
}

function gridRects(n: number, x: number, y: number, w: number, h: number, g: number): Rect[] {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (w - (cols - 1) * g) / cols, rh = (h - (rows - 1) * g) / rows;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    // Ultimul rând incomplet se întinde pe toată lățimea.
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const ww = (w - (inRow - 1) * g) / inRow;
    out.push([x + (inRow === cols ? c * (cw + g) : c * (ww + g)), y + r * (rh + g), inRow === cols ? cw : ww, rh]);
  }
  return out;
}

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.35);
  ctx.bezierCurveTo(cx - s * 0.95, cy - s * 0.25, cx - s * 0.55, cy - s * 0.95, cx, cy - s * 0.45);
  ctx.bezierCurveTo(cx + s * 0.55, cy - s * 0.95, cx + s * 0.95, cy - s * 0.25, cx, cy + s * 0.35);
  ctx.closePath();
}

/** Deterministic: același colaj la fiecare previzualizare (polaroidurile nu „tremură”). */
function rnd(i: number): number { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

export function renderCollage(ctx: CanvasRenderingContext2D, W: number, H: number, all: Img[], o: CollageOptions): void {
  const k = W / 1080;
  const imgs = all.slice(0, MODEL_MAX[o.model]);
  background(ctx, W, H, imgs, o, k);
  const g = Math.round((6 + o.gap * 34) * k);
  const r = Math.round(o.radius * 44 * k);
  const pad = 56 * k;

  switch (o.model) {
    case 'bento':
    case 'grid': {
      const top = titleBlock(ctx, W, pad - 10 * k, o, k);
      const rects = (o.model === 'bento' ? bentoRects : gridRects)(imgs.length, pad, top, W - pad * 2, H - top - pad - 20 * k, g);
      rects.forEach((rc, i) => imgs[i] && coverDraw(ctx, imgs[i], rc[0], rc[1], rc[2], rc[3], r));
      break;
    }
    case 'polaroid': {
      const top = titleBlock(ctx, W, pad - 10 * k, o, k, 'center');
      const n = imgs.length;
      const pw = W * (n <= 3 ? 0.56 : 0.48), ph = pw * 1.18;
      const areaH = H - top - pad;
      imgs.forEach((img, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const cx = W * (0.3 + 0.4 * ((i % 2) ? 1 - rnd(i) * 0.4 : rnd(i) * 0.4));
        const cy = top + ph / 2 + t * Math.max(0, areaH - ph);
        const ang = (rnd(i + 7) - 0.5) * 0.32;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        shadow(ctx, k, true);
        ctx.fillStyle = '#fbfaf7';
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        shadow(ctx, k, false);
        const m = pw * 0.06;
        coverDraw(ctx, img, -pw / 2 + m, -ph / 2 + m, pw - m * 2, pw - m * 2, 2 * k);
        ctx.restore();
      });
      break;
    }
    case 'film': {
      const top = titleBlock(ctx, W, pad - 10 * k, o, k, 'center');
      const sw = W * 0.72, sx = (W - sw) / 2;
      const sh = H - top - pad - 30 * k;
      ctx.fillStyle = '#0d0c10';
      ctx.fillRect(sx, top, sw, sh);
      const hole = 22 * k;
      ctx.fillStyle = isLight(o) ? '#efe9e1' : '#2a2833';
      for (let yy = top + 18 * k; yy < top + sh - hole; yy += hole * 2) {
        ctx.beginPath(); ctx.roundRect(sx + 14 * k, yy, hole, hole * 0.9, 4 * k); ctx.fill();
        ctx.beginPath(); ctx.roundRect(sx + sw - 14 * k - hole, yy, hole, hole * 0.9, 4 * k); ctx.fill();
      }
      const fx = sx + 56 * k, fw = sw - 112 * k;
      const n = imgs.length;
      const fh = (sh - 40 * k - (n - 1) * g) / n;
      imgs.forEach((img, i) => coverDraw(ctx, img, fx, top + 20 * k + i * (fh + g), fw, fh, Math.min(r, 10 * k)));
      break;
    }
    case 'magazine': {
      // Poza mare pe tot ecranul, titlul mare jos, două ferestre mici.
      if (imgs[0]) coverDraw(ctx, imgs[0], 0, 0, W, H, 0);
      const shade = ctx.createLinearGradient(0, H * 0.45, 0, H);
      shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.78)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
      const small = W * 0.3;
      [imgs[1], imgs[2]].forEach((img, i) => {
        if (!img) return;
        const x = W - pad - small, y = pad + i * (small * 1.25 + g + 10 * k);
        ctx.save(); shadow(ctx, k, true);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x - 8 * k, y - 8 * k, small + 16 * k, small * 1.25 + 16 * k, r + 8 * k); ctx.fill();
        ctx.restore();
        coverDraw(ctx, img, x, y, small, small * 1.25, r);
      });
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(112 * k)}px Georgia, "Times New Roman", serif`;
      ctx.fillText(o.title || ' ', pad, H - pad - (o.subtitle ? 70 * k : 10 * k), W - pad * 2);
      if (o.subtitle) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `600 ${Math.round(32 * k)}px system-ui, sans-serif`;
        ctx.fillText(o.subtitle.toUpperCase(), pad, H - pad - 10 * k, W - pad * 2);
      }
      break;
    }
    case 'heart': {
      const top = titleBlock(ctx, W, pad - 10 * k, o, k, 'center');
      const s = Math.min(W * 0.78, (H - top - pad) * 0.8);
      const cx = W / 2, cy = top + (H - top - pad) * 0.5 + s * 0.2;
      ctx.save();
      shadow(ctx, k, true);
      heartPath(ctx, cx, cy, s);
      ctx.fillStyle = '#000'; ctx.fill();
      ctx.restore();
      ctx.save();
      heartPath(ctx, cx, cy, s);
      ctx.clip();
      const box: Rect = [cx - s, cy - s, s * 2, s * 1.4];
      gridRects(imgs.length, box[0], box[1], box[2], box[3], Math.max(2 * k, g / 2)).forEach((rc, i) => imgs[i] && coverDraw(ctx, imgs[i], rc[0], rc[1], rc[2], rc[3], 0));
      ctx.restore();
      break;
    }
    case 'stack': {
      // Carduri suprapuse, ușor rotite, ca într-o poveste.
      const top = titleBlock(ctx, W, pad - 10 * k, o, k, 'left', 72);
      const n = imgs.length;
      const cw = W * 0.74, chh = Math.min(cw * 1.2, (H - top - pad) / (1 + (n - 1) * 0.55));
      imgs.forEach((img, i) => {
        const x = (i % 2 ? W - pad - cw : pad) + (rnd(i) - 0.5) * 30 * k;
        const y = top + i * chh * 0.55;
        ctx.save();
        ctx.translate(x + cw / 2, y + chh / 2);
        ctx.rotate((i % 2 ? 1 : -1) * (0.03 + rnd(i + 3) * 0.04));
        shadow(ctx, k, true);
        ctx.fillStyle = isLight(o) ? '#fff' : '#1a1822';
        ctx.beginPath(); ctx.roundRect(-cw / 2 - 10 * k, -chh / 2 - 10 * k, cw + 20 * k, chh + 20 * k, r + 10 * k); ctx.fill();
        shadow(ctx, k, false);
        coverDraw(ctx, img, -cw / 2, -chh / 2, cw, chh, r);
        ctx.restore();
      });
      break;
    }
  }
  brand(ctx, W, H, o, k);
}

export async function collageBlob(imgs: Img[], o: CollageOptions): Promise<Blob | null> {
  const { w, h } = formatSize(o.format);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  renderCollage(ctx, w, h, imgs, o);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}
