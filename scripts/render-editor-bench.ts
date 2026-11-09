/**
 * Grila înainte/după pe 20 de fotografii reale.
 * Rulează: npx tsx scripts/render-editor-bench.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { meanCast, meanLuma, measureFrame, type LookFace } from '../src/core/autoLook.ts';
import { renderLook } from '../src/core/renderLook.ts';

interface Sample {
  id: string;
  file: string;
  label: string;
  faces?: [number, number, number, number][];
}

const samples: Sample[] = [
  { id: '01-dark-village', file: 'docs/real-photo-samples/underexposed-photo.jpg', label: 'Întuneric · sat' },
  { id: '02-golden-portrait', file: 'docs/real-photo-samples/backlit-headshot.jpg', label: 'Portret auriu', faces: [[0.32, 0.16, 0.36, 0.24]] },
  { id: '03-city-backlight', file: 'docs/real-photo-samples/city-backlight.jpg', label: 'Oraș în contralumină' },
  { id: '04-contrejour', file: 'docs/real-photo-samples/bench/file-contre-jour-photographs-of-a-handsome-man-with-a-hipste.jpg', label: 'Portret cu soare în cadru', faces: [[0.48, 0.22, 0.22, 0.24]] },
  { id: '05-skin', file: 'docs/real-photo-samples/bench/file-elderly-gambian-woman-face-portrait-jpg.jpg', label: 'Ten', faces: [[0.25, 0.30, 0.50, 0.42]] },
  { id: '06-candle', file: 'docs/real-photo-samples/bench/file-candlelight-dinner-flickr-robert-couse-baker-jpg.jpg', label: 'Interior cald' },
  { id: '07-food', file: 'docs/real-photo-samples/bench/file-full-english-breakfast-at-the-chalet-cafe-cowfold-west-.jpg', label: 'Mâncare' },
  { id: '08-alps', file: 'docs/real-photo-samples/bench/file-julian-alps-from-vrsic-pass-3-jpg.jpg', label: 'Peisaj' },
  { id: '09-indoor', file: 'docs/real-photo-samples/bench/file-living-room-in-apartment-of-condom-nio-do-edif-cio-zahe.jpg', label: 'Interior' },
  { id: '10-dark-shore', file: 'docs/real-photo-samples/bench/file-underexposed-pulau-ubin-4440132168-jpg.jpg', label: 'Întuneric · țărm' },
  { id: '11-night', file: 'docs/real-photo-samples/bench/file-gadong-night-market-02-jpg.jpg', label: 'Noapte' },
  { id: '12-smog', file: 'docs/real-photo-samples/bench/file-view-of-smog-from-universal-city-hotel-nara-542579-jpg.jpg', label: 'Ceață / smog' },
  { id: '13-mist', file: 'docs/real-photo-samples/bench/file-a-misty-dawn-dandenong-ranges-jpg.jpg', label: 'Zori încețoșate' },
  { id: '14-dull-sky', file: 'docs/real-photo-samples/bench/file-cloudy-sky-over-the-field-in-russia-img-006-jpg.jpg', label: 'Cer mohorât' },
  { id: '15-dutch', file: 'docs/real-photo-samples/bench/file-baltic-sea-horizon-49817814978-jpg.jpg', label: 'Orizont foarte înclinat' },
  { id: '16-highlights', file: 'docs/real-photo-samples/bench/file-blown-out-highlights-jpg.jpg', label: 'Lumini arse' },
  { id: '17-blue-hour', file: 'docs/real-photo-samples/bench/file-basilica-sancti-petri-blue-hour-jpg.jpg', label: 'Dominantă albastră' },
  { id: '18-window', file: 'docs/real-photo-samples/bench/file-available-light-portrait-jpg.jpg', label: 'Portret la fereastră', faces: [[0.32, 0.22, 0.30, 0.26]] },
  { id: '19-beach', file: 'docs/real-photo-samples/bench/file-havelock-island-mangrove-tree-on-the-beach-andaman-isla.jpg', label: 'Plajă · orizont' },
  { id: '20-fog', file: 'docs/real-photo-samples/bench/file-fog-in-forest-at-kent-washington-1-jpg.jpg', label: 'Pădure în ceață' }
];

function decode(path: string): { width: number; height: number; data: Uint8ClampedArray } {
  const py = [
    'import struct, sys',
    'from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("RGBA")',
    'w, h = im.size',
    'if max(w, h) > 900:',
    '    s = 900 / max(w, h)',
    '    im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.Resampling.LANCZOS)',
    'sys.stdout.buffer.write(struct.pack(">II", im.width, im.height))',
    'sys.stdout.buffer.write(im.tobytes())'
  ].join('\n');
  const result = spawnSync('python3', ['-c', py, path], { encoding: 'buffer', maxBuffer: 48 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || path);
  const bytes = result.stdout;
  const width = bytes.readUInt32BE(0), height = bytes.readUInt32BE(4);
  return { width, height, data: new Uint8ClampedArray(bytes.subarray(8)) };
}

function span(data: Uint8ClampedArray): number {
  const vals: number[] = [];
  for (let i = 0; i < data.length; i += 16) vals.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  vals.sort((a, b) => a - b);
  if (!vals.length) return 0;
  return (vals[Math.floor(vals.length * 0.9)] - vals[Math.floor(vals.length * 0.1)]) / 255;
}

const outDir = 'docs/real-photo-samples/rendered';
mkdirSync(outDir, { recursive: true });

const report = samples.map(sample => {
  const faces: LookFace[] = (sample.faces ?? []).map(box => ({ box }));
  const image = decode(sample.file);
  const before = measureFrame(image.data, image.width, image.height, faces, 2);
  const t0 = Date.now();
  const { data, recipe } = renderLook(image.data, image.width, image.height, faces);
  const ms = Date.now() - t0;
  const after = measureFrame(data, image.width, image.height, faces, 2);
  const lumaDelta = after.mean - before.mean;
  const castDelta = Math.abs(meanCast(image.data)) - Math.abs(meanCast(data));
  const spanDelta = span(data) - span(image.data);
  const faceDelta = before.faceCore !== null && after.faceCore !== null ? after.faceCore - before.faceCore : 0;
  const toward = Math.abs(before.mean - 0.46) - Math.abs(after.mean - 0.46);
  const reasons: string[] = [];
  if (toward > 0.04) reasons.push('lumina se apropie de un mijloc citibil');
  if (faceDelta > 0.04) reasons.push('fața se deschide');
  if (castDelta > 0.02) reasons.push('dominanta scade');
  if (spanDelta > 0.04 && recipe.issues.some(id => id === 'haze' || id === 'flat' || id === 'dullSky')) reasons.push('contrastul crește');
  if (Math.abs(recipe.horizonDeg) >= 1.5) reasons.push(`orizont îndreptat ${recipe.horizonDeg}°`);
  let verdict: 'improved' | 'not-improved' = reasons.length ? 'improved' : 'not-improved';
  let note = reasons.join('; ');
  if (verdict === 'not-improved') {
    if (!recipe.issues.length || (Object.keys(recipe.adjustments).length === 0 && recipe.relight === 0)) {
      note = 'Deja bună. Editorul nu inventează un look.';
    } else if (sample.id === '15-dutch') {
      note = 'Unghi voit, peste plafonul de 7,5°. Nu se îndreaptă.';
    } else if (sample.id === '05-skin') {
      note = 'Ten închis bine expus. Nu se mai luminează ca o greșeală.';
    } else if (sample.id === '02-golden-portrait') {
      note = 'Aurul rămâne. Diferența e mică: luminile arse coboară puțin.';
    } else {
      note = 'Diferența nu e clară. Nu o număr ca reușită.';
    }
  }
  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(`${outDir}/${sample.id}.rgba`, Buffer.concat([
    Buffer.from(new Uint32Array([image.width, image.height]).buffer),
    raw
  ]));
  // păstrăm și originalul redimensionat, ca grila să compare același cadru
  const src = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  writeFileSync(`${outDir}/${sample.id}.before.rgba`, Buffer.concat([
    Buffer.from(new Uint32Array([image.width, image.height]).buffer),
    src
  ]));
  return {
    id: sample.id,
    label: sample.label,
    file: sample.file,
    width: image.width,
    height: image.height,
    ms,
    issues: recipe.issues,
    adjustments: { ...recipe.adjustments, relight: recipe.relight, horizonDeg: recipe.horizonDeg },
    meanLumaBefore: Number(before.mean.toFixed(4)),
    meanLumaAfter: Number(after.mean.toFixed(4)),
    faceBefore: before.faceCore === null ? null : Number(before.faceCore.toFixed(4)),
    faceAfter: after.faceCore === null ? null : Number(after.faceCore.toFixed(4)),
    verdict,
    note
  };
});

writeFileSync('docs/real-photo-samples/bench-results.json', JSON.stringify(report, null, 2));
const improved = report.filter(r => r.verdict === 'improved').length;
console.log(`improved ${improved}/${report.length}`);
for (const row of report) console.log(row.verdict.padEnd(13), row.id, row.note);
