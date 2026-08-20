import { describe, it, expect } from 'vitest';
import {
  planRecapVideo, frameOpacity, frameScale,
  HOLD_MS, FADE_MS, MAX_TOTAL_MS, MIN_PHOTOS, PAN_SCALE
} from './recapVideo';

const ids = (n: number) => Array.from({ length: n }, (_, i) => 'p' + i);

describe('planRecapVideo', () => {
  it('nu face clip din prea putine poze — ar fi o poza cu muzica', () => {
    expect(planRecapVideo(ids(MIN_PHOTOS - 1))).toBeNull();
    expect(planRecapVideo([])).toBeNull();
  });

  it('tranzitiile se suprapun, nu se aduna la durata', () => {
    const plan = planRecapVideo(ids(3))!;
    // 3 poze: 3*hold - 2*fade, nu 3*hold + 2*fade
    expect(plan.totalMs).toBe(3 * HOLD_MS - 2 * FADE_MS);
  });

  it('fiecare poza incepe exact cand precedenta intra in tranzitie', () => {
    const plan = planRecapVideo(ids(4))!;
    for (let i = 1; i < plan.frames.length; i++) {
      const prev = plan.frames[i - 1];
      expect(plan.frames[i].startMs).toBe(prev.startMs + prev.durationMs - FADE_MS);
    }
  });

  it('taie la plafonul de durata si spune cate a lasat pe dinafara', () => {
    const plan = planRecapVideo(ids(200))!;
    expect(plan.totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS);
    expect(plan.omitted).toBe(200 - plan.frames.length);
    expect(plan.frames.length).toBeGreaterThan(MIN_PHOTOS);
  });

  it('nu taie nimic cand totul incape', () => {
    const plan = planRecapVideo(ids(5))!;
    expect(plan.omitted).toBe(0);
    expect(plan.frames).toHaveLength(5);
  });

  it('pastreaza ordinea primita — alegerea apartine apelantului', () => {
    const plan = planRecapVideo(['c', 'a', 'b'])!;
    expect(plan.frames.map(f => f.id)).toEqual(['c', 'a', 'b']);
  });

  it('respecta un plafon dat explicit', () => {
    const plan = planRecapVideo(ids(50), 10_000)!;
    expect(plan.totalMs).toBeLessThanOrEqual(10_000);
  });
});

describe('frameOpacity', () => {
  const plan = planRecapVideo(ids(3))!;

  it('prima poza NU intra din negru, ultima nu iese in negru', () => {
    expect(frameOpacity(plan, 0, 1)).toBe(1);
    const last = plan.frames[2];
    expect(frameOpacity(plan, 2, last.startMs + last.durationMs - 1)).toBe(1);
  });

  it('pozele din mijloc intra si ies gradat', () => {
    const f = plan.frames[1];
    expect(frameOpacity(plan, 1, f.startMs)).toBe(0);
    expect(frameOpacity(plan, 1, f.startMs + FADE_MS / 2)).toBeCloseTo(0.5, 2);
    expect(frameOpacity(plan, 1, f.startMs + FADE_MS)).toBe(1);
  });

  it('e zero inainte sa apara si dupa ce dispare', () => {
    const f = plan.frames[1];
    expect(frameOpacity(plan, 1, f.startMs - 10)).toBe(0);
    expect(frameOpacity(plan, 1, f.startMs + f.durationMs + 10)).toBe(0);
  });

  it('in orice moment se vede ceva — nu exista gauri negre in clip', () => {
    for (let t = 0; t < plan.totalMs; t += 25) {
      const total = plan.frames.reduce((sum, _, i) => sum + frameOpacity(plan, i, t), 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it('un index inexistent nu arunca', () => {
    expect(frameOpacity(plan, 99, 100)).toBe(0);
  });
});

describe('frameScale', () => {
  const plan = planRecapVideo(ids(3))!;

  it('panoramarea merge de la 1 la PAN_SCALE pe durata pozei', () => {
    const f = plan.frames[0];
    expect(frameScale(plan, 0, f.startMs)).toBe(1);
    expect(frameScale(plan, 0, f.startMs + f.durationMs)).toBeCloseTo(PAN_SCALE, 5);
  });

  it('ramane in limite chiar si in afara intervalului', () => {
    expect(frameScale(plan, 0, -500)).toBe(1);
    expect(frameScale(plan, 0, 999_999)).toBeCloseTo(PAN_SCALE, 5);
  });
});
