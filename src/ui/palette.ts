/**
 * Culoarea de accent a cadrului curent. Nu e un model: grupează pixelii
 * unui eșantion mic și păstrează grupul cel mai saturat, sărind peste
 * negru și alb, care nu spun nimic despre poză.
 */
export function accentFromPixels(data: ArrayLike<number>): string {
  let best = -1;
  let r = 125;
  let g = 255;
  let b = 244;
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rr = data[i];
    const gg = data[i + 1];
    const bb = data[i + 2];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    if (max < 28 || min > 240) continue;
    const key = ((rr >> 4) << 8) | ((gg >> 4) << 4) | (bb >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += rr;
    bucket.g += gg;
    bucket.b += bb;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const rr = bucket.r / bucket.n;
    const gg = bucket.g / bucket.n;
    const bb = bucket.b / bucket.n;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const score = sat * Math.sqrt(bucket.n);
    if (score > best) {
      best = score;
      r = rr;
      g = gg;
      b = bb;
    }
  }
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Textul de deasupra accentului: închis pe o culoare deschisă. */
export function inkForAccent(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return '#12141c';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y > 160 ? '#12141c' : '#f4f7ff';
}
