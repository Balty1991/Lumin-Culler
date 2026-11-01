import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { meanLuma, type LookFace } from '../src/core/autoLook.ts';
import { renderLook } from '../src/core/renderLook.ts';

const samples = [
  { file: 'docs/real-photo-samples/underexposed-photo.jpg', key: 'underexposed', faces: [] as LookFace[] },
  // Fața este delimitată manual ca input de test; rețeta actuală nu a activat
  // relight-ul aici. Proba nu testează detectarea automată a fețelor.
  { file: 'docs/real-photo-samples/backlit-headshot.jpg', key: 'backlit-headshot', faces: [{ box: [0.36, 0.20, 0.27, 0.20] }] as LookFace[] },
  { file: 'docs/real-photo-samples/city-backlight.jpg', key: 'city-backlight', faces: [] as LookFace[] }
];
const outputDir = 'docs/real-photo-samples/rendered';
mkdirSync(outputDir, { recursive: true });

function decodeJpeg(path: string): { width: number; height: number; data: Uint8ClampedArray } {
  const python = [
    'import struct, sys',
    'from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("RGBA")',
    'sys.stdout.buffer.write(struct.pack(">II", im.width, im.height))',
    'sys.stdout.buffer.write(im.tobytes())'
  ].join('\n');
  const result = spawnSync('python3', ['-c', python, path], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Nu am putut decoda ${path} cu Pillow: ${result.stderr?.toString() ?? ''}`);
  const bytes = result.stdout;
  if (!bytes || bytes.length < 8) throw new Error(`Imagine goală sau invalidă: ${path}`);
  const width = bytes.readUInt32BE(0), height = bytes.readUInt32BE(4);
  if (bytes.length !== 8 + width * height * 4) throw new Error(`Dimensiune neașteptată pentru ${path}`);
  return { width, height, data: new Uint8ClampedArray(bytes.subarray(8)) };
}

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
function writePng(path: string, width: number, height: number, data: Uint8ClampedArray) {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    scanlines[row] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(scanlines, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

const report = samples.map(sample => {
  const image = decodeJpeg(sample.file);
  const { data, recipe } = renderLook(image.data, image.width, image.height, sample.faces);
  const output = join(outputDir, `${sample.key}-after.png`);
  writePng(output, image.width, image.height, data);
  return {
    sample: basename(sample.file),
    output: output.replaceAll('\\', '/'),
    width: image.width,
    height: image.height,
    issuesDetected: recipe.issues,
    meanLumaBefore: Number(meanLuma(image.data).toFixed(4)),
    meanLumaAfter: Number(meanLuma(data).toFixed(4)),
    adjustments: { ...recipe.adjustments, relight: recipe.relight, redEye: recipe.redEye }
  };
});
writeFileSync('docs/real-photo-samples/results.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
