import { describe, it, expect } from 'vitest';
import {
  fixesFor, buildRescueQueue, countRescuable,
  MIN_BASE_SHARPNESS, CLIPPING_THRESHOLD, TILT_THRESHOLD, EXPOSURE_DEVIATION, THIRDS_THRESHOLD,
  type RescueCandidate
} from './rescueQueue';

function p(over: Partial<RescueCandidate> = {}): RescueCandidate {
  return { id: 'a', status: 'rejected', aiScore: 40, sharpness: 70, exposure: 50, faceCount: 0, ...over };
}

describe('fixesFor', () => {
  it('un cadru fara probleme nu are nimic de reparat', () => {
    expect(fixesFor(p())).toEqual([]);
  });

  it('nu propune nimic pentru un cadru prea neclar — nu recuperezi cerul dintr-o poza miscata', () => {
    expect(fixesFor(p({
      sharpness: MIN_BASE_SHARPNESS - 1, highlightClipping: 0.5, horizonTiltDeg: 10, exposure: 10
    }))).toEqual([]);
  });

  it('prinde expunerea gresita, in ambele directii', () => {
    expect(fixesFor(p({ exposure: 50 - EXPOSURE_DEVIATION }))).toContain('exposure');
    expect(fixesFor(p({ exposure: 50 + EXPOSURE_DEVIATION }))).toContain('exposure');
    expect(fixesFor(p({ exposure: 50 + EXPOSURE_DEVIATION - 1 }))).not.toContain('exposure');
  });

  it('prinde highlights si shadows peste prag', () => {
    expect(fixesFor(p({ highlightClipping: CLIPPING_THRESHOLD + 0.01 }))).toContain('highlights');
    expect(fixesFor(p({ shadowClipping: CLIPPING_THRESHOLD + 0.01 }))).toContain('shadows');
    expect(fixesFor(p({ highlightClipping: CLIPPING_THRESHOLD }))).not.toContain('highlights');
  });

  it('prinde orizontul strambat, indiferent de sens', () => {
    expect(fixesFor(p({ horizonTiltDeg: TILT_THRESHOLD + 0.5 }))).toContain('straighten');
    expect(fixesFor(p({ horizonTiltDeg: -(TILT_THRESHOLD + 0.5) }))).toContain('straighten');
    expect(fixesFor(p({ horizonTiltDeg: TILT_THRESHOLD }))).not.toContain('straighten');
  });

  it('propune recadrare doar cand exista un subiect uman', () => {
    expect(fixesFor(p({ faceCount: 1, ruleOfThirds: THIRDS_THRESHOLD - 0.1 }))).toContain('crop');
    // pe peisaj, "prea in centru" e adesea chiar intentia
    expect(fixesFor(p({ faceCount: 0, ruleOfThirds: THIRDS_THRESHOLD - 0.1 }))).not.toContain('crop');
  });

  it('nu propune NICIODATA ceva ce nu se poate repara', () => {
    // un cadru miscat cu ochii inchisi: nicio corectie, oricat de rau ar fi
    const fixes = fixesFor(p({ sharpness: 20, aiScore: 5 }));
    expect(fixes).toEqual([]);
    expect(fixes as string[]).not.toContain('sharpness');
    expect(fixes as string[]).not.toContain('eyes');
  });
});

describe('buildRescueQueue', () => {
  it('sare peste pozele deja pastrate — nu are pe cine convinge', () => {
    const q = buildRescueQueue([p({ id: 'keep', status: 'selected', exposure: 20 })]);
    expect(q).toEqual([]);
  });

  it('include respinse si nedecise', () => {
    const q = buildRescueQueue([
      p({ id: 'r', status: 'rejected', exposure: 20 }),
      p({ id: 'v', status: 'review', exposure: 20 }),
      p({ id: 'n', status: 'pending', exposure: 20 })
    ]);
    expect(q.map(i => i.id).sort()).toEqual(['n', 'r', 'v']);
  });

  it('ordoneaza dupa cat au de castigat', () => {
    const q = buildRescueQueue([
      p({ id: 'putin', horizonTiltDeg: 5 }),
      p({ id: 'mult', exposure: 20, highlightClipping: 0.3, horizonTiltDeg: 5 })
    ]);
    expect(q[0].id).toBe('mult');
    expect(q[0].gain).toBeGreaterThan(q[1].gain);
  });

  it('nu promite castig peste 100 de puncte', () => {
    const q = buildRescueQueue([p({ aiScore: 96, exposure: 20, highlightClipping: 0.3, horizonTiltDeg: 5 })]);
    expect(q[0].gain).toBe(4);
  });

  it('exclude un cadru care e deja la maximum', () => {
    expect(buildRescueQueue([p({ aiScore: 100, exposure: 20 })])).toEqual([]);
  });

  it('respecta limita', () => {
    const many = Array.from({ length: 80 }, (_, i) => p({ id: `p${i}`, exposure: 20 }));
    expect(buildRescueQueue(many, 10)).toHaveLength(10);
  });

  it('ordinea e stabila la egalitate perfecta', () => {
    const q = buildRescueQueue([p({ id: 'b', exposure: 20 }), p({ id: 'a', exposure: 20 })]);
    expect(q.map(i => i.id)).toEqual(['a', 'b']);
  });
});

describe('countRescuable', () => {
  it('numara la fel ca lista, fara sa o construiasca', () => {
    const photos = [
      p({ id: '1', exposure: 20 }),
      p({ id: '2', status: 'selected', exposure: 20 }),
      p({ id: '3' }),
      p({ id: '4', horizonTiltDeg: 9 })
    ];
    expect(countRescuable(photos)).toBe(2);
    expect(buildRescueQueue(photos)).toHaveLength(2);
  });
});
