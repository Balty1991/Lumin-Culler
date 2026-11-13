import { db } from '../core/db';
import { useStore } from '../state/store';
import { loadImage } from './collage';
import { DEFECT_SHARPNESS } from '../core/importPipeline';

/**
 * lumin/faceFocus.ts
 * Claritatea măsurată pe față, nu pe toată poza (cerut: „motor mai performant”). Un portret cu
 * fundalul estompat intenționat (modul Portret, bokeh) ieșea „neclar” după media pe toată poza.
 * Aici: variația laplaciană pe caseta feței, comparată cu cea a întregii poze. Fața clar mai
 * clară decât restul = subiectul e în focus → poza nu mai e tratată ca mișcată.
 * Rulează după citire, pe pozele cu oameni socotite neclare, câte una, pe pauze.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function lapVar(g: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0, s = 0, s2 = 0;
  for (let y = Math.max(1, y0); y < Math.min(y1, (g.length / w) - 1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(x1, w - 1); x++) {
      const i = y * w + x;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += v; s2 += v * v; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

/** Fața (caseta 0..1) e clar mai clară decât poza întreagă? Exportat pentru teste. */
export function faceSharperThanFrame(g: Float32Array, w: number, h: number, box: readonly number[]): boolean {
  const [bx, by, bw, bh] = box;
  const x0 = Math.floor(bx * w), y0 = Math.floor(by * h), x1 = Math.ceil((bx + bw) * w), y1 = Math.ceil((by + bh) * h);
  if (x1 - x0 < 12 || y1 - y0 < 12) return false;
  const face = lapVar(g, w, x0, y0, x1, y1);
  const all = lapVar(g, w, 0, 0, w, h);
  return face >= 25 && face >= all * 1.25;
}

let running = false;
export async function faceFocusPass(): Promise<number> {
  if (running) return 0;
  running = true;
  let fixed = 0;
  try {
    const cands = useStore.getState().photos.filter(p => (p.faceCount ?? 0) > 0 && !p.aside && (p.sharpness ?? 100) < DEFECT_SHARPNESS + 15);
    for (const p of cands) {
      if (useStore.getState().progress) return fixed;
      const a = await db.analyses.get(p.id);
      const box = a?.faces?.slice().sort((x, y) => (y.box[2] * y.box[3]) - (x.box[2] * x.box[3]))[0]?.box;
      if (!a || !box || a.faceFocusChecked) continue;
      const img = await loadImage(p.id);
      let sharp = false;
      if (img) {
        const k = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(16, Math.round(img.naturalWidth * k)), h = Math.max(16, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          const g = new Float32Array(w * h);
          for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
          sharp = faceSharperThanFrame(g, w, h, box);
        }
      }
      const next = { ...a, faceFocusChecked: true, ...(sharp ? { subjectInFocus: true, sharpness: Math.max(a.sharpness, DEFECT_SHARPNESS + 10) } : {}) };
      await db.analyses.put(next);
      if (sharp) {
        fixed++;
        useStore.setState(s => ({ photos: s.photos.map(x => (x.id === p.id ? { ...x, sharpness: next.sharpness, subjectInFocus: true } : x)) }));
      }
      await sleep(30);
    }
    return fixed;
  } finally {
    running = false;
  }
}
