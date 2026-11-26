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
    const e = mix(vec('cat'), vec('dog'), 0.6);
    const p = Object.fromEntries(zeroShot(e).map(r => [r.key, r.p]));
    expect(p.dog).toBeGreaterThan(0.05); // regula veche n-ar fi scos câinele
    expect(p.cat).toBeGreaterThan(p.dog * 2);
    expect(refineTags(['Skin', 'Pet', 'Dog'], e)).not.toContain('Dog');
  });
  it('păstrează câinele când CLIP vede câine', () => {
    expect(refineTags(['Pet', 'Dog'], vec('dog'))).toContain('Dog');
  });
});

describe('refineTags — CLIP adaugă specia', () => {
  it('pune „cat” când CLIP vede pisica lângă un copil, iar ML Kit n-a dat specia', () => {
    const e = mix(vec('cat'), vec('child'), 0.55);
    const tags = refineTags(['Skin', 'Smile', 'Pet'], e);
    expect(tags).toContain('cat');
    expect(tags).not.toContain('dog');
  });
  it('nu pune nicio specie pe o poză fără animal', () => {
    expect(refineTags(['Balloon', 'Party'], vec('party')).some(t => ['cat', 'dog'].includes(t))).toBe(false);
  });
});

import { speciesMatches } from './clipEngine';
import { speciesOf } from './clipSearch';

describe('căutarea după specie, din amprente', () => {
  it('recunoaște cuvântul, și pe bucăți', () => {
    expect(speciesOf('Pisi')).toBe('cat');
    expect(speciesOf('pisică')).toBe('cat');
    expect(speciesOf('câini')).toBe('dog');
    expect(speciesOf('tort')).toBeNull();
  });
  it('găsește pisica lângă copil, nu și poza fără animal', () => {
    const rows = [mix(vec('cat'), vec('child'), 0.55), vec('party'), mix(vec('dog'), vec('child'), 0.6)];
    const m = new Float32Array(rows.length * 512);
    rows.forEach((r, i) => m.set(r, i * 512));
    expect(speciesMatches(['a', 'b', 'c'], m, 'cat')).toEqual(['a']);
    expect(speciesMatches(['a', 'b', 'c'], m, 'dog')).toEqual(['c']);
  });
});

import { otherSpecies } from './clipEngine';
describe('pisica mică lângă un copil', () => {
  it('scoate „Dog” pus de ML Kit când CLIP vede puțină pisică și deloc câine', () => {
    const e = mix(vec('cat'), vec('child'), 0.41);
    const p = Object.fromEntries(zeroShot(e).map(r => [r.key, r.p]));
    expect(p.cat).toBeLessThan(0.1); // regula veche cerea 0,1
    expect(p.cat).toBeGreaterThanOrEqual(0.03);
    expect(refineTags(['Person', 'Dog'], e)).not.toContain('Dog');
    expect(otherSpecies(e, 'dog')).toBe(true);
    expect(otherSpecies(e, 'cat')).toBe(false);
  });
});

describe('alt animal văzut clar', () => {
  it('scoate „Cat” de pe poza cu vaca', () => {
    const e = mix(vec('cow'), vec('child'), 0.6);
    expect(refineTags(['Person', 'Cat', 'Grass'], e)).not.toContain('Cat');
  });
});
