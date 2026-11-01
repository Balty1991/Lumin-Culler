/**
 * Construiește grila înainte/după pentru 12 scene controlate.
 * Rulează: node --experimental-strip-types scripts/render-auto-look.ts
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { meanCast, meanLuma, type LookFace } from '../src/core/autoLook.ts';
import { renderLook } from '../src/core/renderLook.ts';

const W = 120;
const H = 90;
const face: LookFace = { box: [0.34, 0.2, 0.32, 0.36] };

function buf(px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = px(x, y);
    const i = (y * W + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}

const noise = (x: number, y: number, a: number) => ((x * 17 + y * 31) % 17) - 8 + a;

const scenes: { name: string; faces?: LookFace[]; src: Uint8ClampedArray }[] = [
  { name: 'dark', src: buf((x, y) => [22 + noise(x, y, 0), 20, 18]) },
  { name: 'bright', src: buf((x, y) => [230 + (y % 3), 228, 226]) },
  { name: 'backlit', faces: [face], src: buf((x, y) => {
    const u = x / W, v = y / H;
    return u > 0.38 && u < 0.66 && v > 0.24 && v < 0.58 ? [36, 28, 24] : [214, 208, 198];
  }) },
  { name: 'blue-cast', src: buf((x, y) => y < 30 ? [140, 168, 214] : [80, 96, 150]) },
  { name: 'tungsten', src: buf((x, y) => [170 + noise(x, y, 0), 120, 70]) },
  { name: 'haze', src: buf((_x, y) => {
    const b = 168 + (y / H) * 18;
    return [b, b + 1, b + 3];
  }) },
  { name: 'night-noise', src: buf((x, y) => {
    const n = (x * 13 + y * 9) % 41;
    return [18 + n, 16 + (n % 11), 20];
  }) },
  { name: 'flat', src: buf((x, y) => {
    const b = 118 + (x % 5);
    return [b, b, b + 2];
  }) },
  { name: 'dull-sky', src: buf((x, y) => y < 34 ? [176, 178, 180] : [70 + (x % 7), 110, 55]) },
  { name: 'red-eye', faces: [face], src: buf((x, y) => {
    const u = x / W, v = y / H;
    if (u > 0.45 && u < 0.52 && v > 0.3 && v < 0.38) return [210, 30, 36];
    if (u > 0.34 && u < 0.66 && v > 0.2 && v < 0.58) return [196, 154, 124];
    return [64, 96, 58];
  }) },
  { name: 'portrait', faces: [face], src: buf((x, y) => {
    const u = x / W, v = y / H;
    if (u > 0.36 && u < 0.64 && v > 0.22 && v < 0.62) return [150, 112, 96];
    return [48, 52, 60];
  }) },
  { name: 'landscape', src: buf((x, y) => {
    if (y < 36) return [160, 168, 176];
    const g = 80 + (x % 9);
    return [40 + (y % 5), g, 36];
  }) }
];

const rows = 3;
const cols = 4;
const pad = 8;
const gap = 4;
const cellW = W * 2 + gap;
const cellH = H + 18;
const outW = cols * cellW + (cols + 1) * pad;
const outH = rows * cellH + (rows + 1) * pad;
const out = new Uint8ClampedArray(outW * outH * 4);
out.fill(14);
for (let i = 3; i < out.length; i += 4) out[i] = 255;

function blit(src: Uint8ClampedArray, sw: number, sh: number, dx: number, dy: number) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4;
      const d = ((dy + y) * outW + (dx + x)) * 4;
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255;
    }
  }
}

const digits: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111']
};

function stamp(n: number, dx: number, dy: number) {
  const glyph = digits[String(n)];
  if (!glyph) return;
  for (let y = 0; y < glyph.length; y++) for (let x = 0; x < glyph[y].length; x++) {
    if (glyph[y][x] !== '1') continue;
    const px = dx + x * 2, py = dy + y * 2;
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
      const d = ((py + oy) * outW + (px + ox)) * 4;
      out[d] = 255; out[d + 1] = 220; out[d + 2] = 230; out[d + 3] = 255;
    }
  }
}

const report: { name: string; ms: number; issues: string[]; before: number; after: number; castBefore: number; castAfter: number }[] = [];
scenes.forEach((scene, index) => {
  const t0 = performance.now();
  const { data, recipe } = renderLook(scene.src, W, H, scene.faces ?? []);
  const ms = performance.now() - t0;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = pad + col * (cellW + pad);
  const y = pad + row * (cellH + pad);
  blit(scene.src, W, H, x, y);
  blit(data, W, H, x + W + gap, y);
  stamp(index + 1, x + 4, y + 4);
  report.push({
    name: scene.name,
    ms: Math.round(ms * 10) / 10,
    issues: recipe.issues,
    before: Math.round(meanLuma(scene.src) * 1000) / 1000,
    after: Math.round(meanLuma(data) * 1000) / 1000,
    castBefore: Math.round(meanCast(scene.src) * 1000) / 1000,
    castAfter: Math.round(meanCast(data) * 1000) / 1000
  });
});

function crc(buf: Buffer): Buffer {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((~c) >>> 0);
  return out;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([len, body, crc(body)]);
}
const raw = Buffer.alloc((outW * 4 + 1) * outH);
for (let y = 0; y < outH; y++) {
  raw[y * (outW * 4 + 1)] = 0;
  Buffer.from(out.buffer, out.byteOffset + y * outW * 4, outW * 4).copy(raw, y * (outW * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(outW, 0);
ihdr.writeUInt32BE(outH, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
]);

mkdirSync('docs', { recursive: true });
writeFileSync('docs/auto-look-samples.png', png);
writeFileSync('docs/auto-look-samples.json', JSON.stringify({ width: outW, height: outH, scenes: report }, null, 2));
console.log(JSON.stringify(report, null, 2));
