import { describe, it, expect } from 'vitest';
import data from './clipLabels.json';
import { aestheticOf, qualityOf, refineTags, zeroShot } from './clipEngine';

function row(key: string): Float32Array {
  const raw = Uint8Array.from(atob(data.text), c => c.charCodeAt(0));
  const u16 = new Uint16Array(raw.buffer);
  const k = data.keys.indexOf(key);
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    const h = u16[k * 512 + i];
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    out[i] = e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return out;
}

describe('clipEngine', () => {
  it('recunoaște eticheta din propriul ei text', () => {
    expect(zeroShot(row('sunset'))[0].key).toBe('sunset');
  });
  it('scoate animalul pe care CLIP nu-l vede și adaugă ce vede sigur', () => {
    const tags = refineTags(['Dog', 'Sky'], row('sunset'));
    expect(tags).not.toContain('Dog');
    expect(tags).toContain('Sky');
    expect(tags).toContain('sunset');
  });
  it('lasă animalul când CLIP îl vede', () => {
    expect(refineTags(['Dog'], row('dog'))).toContain('Dog');
  });
  it('nu adaugă repere (-person) ca etichete', () => {
    expect(refineTags([], row('-person'))).not.toContain('-person');
  });
  it('scorul estetic e pe scara LAION', () => {
    const a = aestheticOf(row('landscape'));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(10);
  });
  it('calitatea e 0..1 pe fiecare pereche', () => {
    const q = qualityOf(row('landscape'));
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(q.score).toBeLessThanOrEqual(1);
    expect(Object.keys(q.parts)).toContain('sharp');
  });
});
