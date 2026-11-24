import { describe, it, expect } from 'vitest';
import data from './clipLabels.json';
import { refineTags, zeroShot } from './clipEngine';

const raw = Uint8Array.from(atob(data.text), c => c.charCodeAt(0));
const u16 = new Uint16Array(raw.buffer);
const half = (h: number) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff; return e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15); };
const vec = (key: string) => { const k = data.keys.indexOf(key); return Array.from({ length: 512 }, (_, i) => half(u16[k * 512 + i])); };
const mix = (a: number[], b: number[], w: number) => { const v = a.map((x, i) => w * x + (1 - w) * b[i]); const n = Math.hypot(...v); return v.map(x => x / n); };

describe('refineTags — CLIP corectează specia', () => {
  it('scoate „Dog” când CLIP vede clar o pisică, chiar dacă vede și puțin câine', () => {
    const e = mix(vec('cat'), vec('dog'), 0.56);
    const p = Object.fromEntries(zeroShot(e).map(r => [r.key, r.p]));
    expect(p.dog).toBeGreaterThan(0.05); // regula veche n-ar fi scos câinele
    expect(p.cat).toBeGreaterThan(p.dog * 2);
    expect(refineTags(['Skin', 'Pet', 'Dog'], e)).not.toContain('Dog');
  });
  it('păstrează câinele când CLIP vede câine', () => {
    expect(refineTags(['Pet', 'Dog'], vec('dog'))).toContain('Dog');
  });
});
