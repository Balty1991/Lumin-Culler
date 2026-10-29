import { describe, expect, it } from 'vitest';
import { instaCrop } from './instaCrop';

describe('instaCrop', () => {
  it('fără fețe: cel mai mare cadru, centrat', () => {
    expect(instaCrop(4000, 3000, '4:5')).toEqual({ x: 800, y: 0, w: 2400, h: 3000 });
    expect(instaCrop(3000, 4000, '1:1')).toEqual({ x: 0, y: 500, w: 3000, h: 3000 });
  });

  it('peisaj cu un om în dreapta: cadrul îl urmează pe orizontală', () => {
    const r = instaCrop(4000, 3000, '9:16', [{ box: [0.8, 0.3, 0.08, 0.1] }]);
    expect(r.w).toBe(1688);
    expect(r.h).toBe(3000);
    // fața (3200–3520 px) e în cadru, aproape de centru
    expect(r.x).toBeLessThanOrEqual(3200);
    expect(r.x + r.w).toBeGreaterThanOrEqual(3520);
  });

  it('portret înalt: fața ajunge în treimea de sus, nu tăiată', () => {
    const r = instaCrop(3000, 6000, '4:5', [{ box: [0.4, 0.5, 0.2, 0.1] }]);
    expect(r.h).toBe(3750);
    const faceTop = 0.5 * 6000;
    const faceCenter = 0.55 * 6000;
    expect(r.y).toBeLessThan(faceTop);
    expect((faceCenter - r.y) / r.h).toBeLessThan(0.45);
  });

  it('cadrul nu iese din poză', () => {
    const r = instaCrop(3000, 6000, '4:5', [{ box: [0.4, 0.95, 0.2, 0.05] }]);
    expect(r.y + r.h).toBeLessThanOrEqual(6000);
    const t = instaCrop(3000, 6000, '4:5', [{ box: [0.4, 0.0, 0.2, 0.05] }]);
    expect(t.y).toBe(0);
  });

  it('fețe prea departe una de alta: se alege cea mai mare', () => {
    const r = instaCrop(6000, 2000, '9:16', [{ box: [0.02, 0.4, 0.03, 0.1] }, { box: [0.85, 0.3, 0.08, 0.2] }]);
    expect(r.x + r.w).toBeGreaterThanOrEqual(0.93 * 6000);
  });
});
