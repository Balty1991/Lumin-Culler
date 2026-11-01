/**
 * lumin/magic.ts
 * Partea de pe telefon a gumei AI și a cerului nou: unde e cerul (masca), ce
 * bucată din poză pleacă la AI (micșorată, cu proporția ei) și cum se pune
 * înapoi rezultatul, la rezoluția pozei, doar în zona din mască, cu margini
 * moi. Restul pozei rămâne neatins, pixel cu pixel.
 */

/** Dreptunghi în pixeli. */
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Cerul: pornind de pe rândul de sus, pixelii luminoși și „de cer” (albastru,
 * gri-alb, fără verde de copaci), legați între ei și asemănători cu vecinii.
 * `rgba` e o copie mică a pozei (ex. 256 px). Întoarce 1 = cer, 0 = altceva.
 */
export function skyMask(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const isSkyish = (i: number) => {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    const blue = b >= r && b >= g - 6;
    const grayWhite = sat < 0.16 && lum > 150;
    const greenish = g > r + 12 && g > b + 8;
    return lum > 110 && !greenish && (blue || grayWhite);
  };
  const close = (a: number, b: number) =>
    Math.abs(rgba[a * 4] - rgba[b * 4]) + Math.abs(rgba[a * 4 + 1] - rgba[b * 4 + 1]) + Math.abs(rgba[a * 4 + 2] - rgba[b * 4 + 2]) < 40;
  const stack: number[] = [];
  for (let x = 0; x < w; x++) if (isSkyish(x)) { mask[x] = 1; stack.push(x); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w, y = (i - x) / w;
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of next) {
      if (n < 0 || mask[n] || !isSkyish(n) || !close(i, n)) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  return mask;
}

export function maskCoverage(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return mask.length ? n / mask.length : 0;
}

/** Cutia care cuprinde masca (în pixelii măștii), lărgită cu `pad` din latura ei și ținută în poză. */
export function maskBounds(mask: Uint8Array, w: number, h: number, pad = 0.35): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Pătrat-ish, cu context în jur: modelul vede ce e lângă ce trebuie șters.
  const side = Math.max(bw, bh) * (1 + 2 * pad);
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const cw = Math.min(w, Math.max(side, 32)), ch = Math.min(h, Math.max(side, 32));
  const x = Math.max(0, Math.min(w - cw, cx - cw / 2));
  const y = Math.max(0, Math.min(h - ch, cy - ch / 2));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) };
}

export type LocalFill = 'erase' | 'sky-blue' | 'sky-sunset';

/**
 * Cer nou sau gumă, fără server: cerul primește un gradient, zona ștearsă
 * ia culoarea celui mai apropiat pixel nemarcat. Marginea se amestecă puțin
 * cu originalul, ca să nu taie cu foarfeca.
 */
export function fillMasked(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, mode: LocalFill): void {
  const src = rgba.slice();
  const nearest = (x: number, y: number): number => {
    for (let rad = 1; rad <= 24; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const xs = dy === -rad || dy === rad ? null : [x - rad, x + rad];
        const row = xs ?? Array.from({ length: rad * 2 + 1 }, (_, k) => x - rad + k);
        for (const xx of row) {
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (!mask[q]) return q;
        }
      }
    }
    return -1;
  };
  for (let y = 0; y < h; y++) {
    const t = h <= 1 ? 0 : y / (h - 1);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!mask[p]) continue;
      const i = p * 4;
      let tr: number, tg: number, tb: number;
      if (mode === 'erase') {
        const q = nearest(x, y);
        if (q < 0) continue;
        tr = src[q * 4]; tg = src[q * 4 + 1]; tb = src[q * 4 + 2];
      } else if (mode === 'sky-blue') {
        tr = 78 + t * 50; tg = 150 + t * 28; tb = 230 - t * 24;
      } else {
        tr = 250 - t * 30; tg = 120 + t * 40; tb = 64 + t * 50;
      }
      const keep = 0.18;
      rgba[i] = Math.round(tr * (1 - keep) + src[i] * keep);
      rgba[i + 1] = Math.round(tg * (1 - keep) + src[i + 1] * keep);
      rgba[i + 2] = Math.round(tb * (1 - keep) + src[i + 2] * keep);
    }
  }
}

/** Mărimea trimisă la AI: latura lungă 512, ambele multiplu de 64, proporția păstrată cât se poate. */
export function aiSize(w: number, h: number): { width: number; height: number } {
  const k = 512 / Math.max(w, h);
  const r64 = (v: number) => Math.max(256, Math.min(768, Math.round(v / 64) * 64));
  return { width: r64(w * k), height: r64(h * k) };
}
