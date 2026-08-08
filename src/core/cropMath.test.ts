import { describe, expect, it } from 'vitest';
import {
  clamp01, normalizedBoxRatio, boxForAspect, moveCropBox, resizeCropFree, resizeCropLocked,
  MIN_CROP_SIZE, FULL_CROP, type CropBox
} from './cropMath';

describe('clamp01', () => {
  it('passes through values already inside the range', () => {
    expect(clamp01(0.5, 0, 1)).toBe(0.5);
  });
  it('clamps below the minimum', () => {
    expect(clamp01(-0.2, 0, 1)).toBe(0);
  });
  it('clamps above the maximum', () => {
    expect(clamp01(1.5, 0, 1)).toBe(1);
  });
});

describe('normalizedBoxRatio', () => {
  it('a square (1:1) on a square photo stays 1:1 in normalized space', () => {
    expect(normalizedBoxRatio(1, 1000, 1000)).toBeCloseTo(1);
  });
  it('a square (1:1) on a portrait photo needs a taller box in normalized space (width:height > 1)', () => {
    // poza portret 3:4 (1000x1333) — un patrat REAL are nevoie de o fractiune
    // de latime MAI MARE decat cea de inaltime, ca sa compenseze faptul ca
    // fractiunile de inaltime "valoreaza" mai putini pixeli reali pe verticala.
    const normR = normalizedBoxRatio(1, 1000, 1333);
    expect(normR).toBeGreaterThan(1);
  });
  it('a square (1:1) on a landscape photo needs a narrower box in normalized space (width:height < 1)', () => {
    const normR = normalizedBoxRatio(1, 1333, 1000);
    expect(normR).toBeLessThan(1);
  });
});

describe('boxForAspect', () => {
  it('a square box (normR=1) on a square frame uses the full frame', () => {
    const box = boxForAspect(1, 0.5, 0.5);
    expect(box.width).toBeCloseTo(1);
    expect(box.height).toBeCloseTo(1);
  });
  it('a wide box (normR>1) uses the full width, shorter height', () => {
    const box = boxForAspect(2, 0.5, 0.5);
    expect(box.width).toBeCloseTo(1);
    expect(box.height).toBeCloseTo(0.5);
  });
  it('a tall box (normR<1) uses the full height, narrower width', () => {
    const box = boxForAspect(0.5, 0.5, 0.5);
    expect(box.height).toBeCloseTo(1);
    expect(box.width).toBeCloseTo(0.5);
  });
  it('centers on (cx, cy) when there is room', () => {
    const box = boxForAspect(0.5, 0.5, 0.5);
    expect(box.x + box.width / 2).toBeCloseTo(0.5);
    expect(box.y + box.height / 2).toBeCloseTo(0.5);
  });
  it('clamps back inside [0,1] instead of centering past an edge', () => {
    // centru foarte aproape de marginea stanga — o caseta centrata perfect
    // ar iesi din cadru pe stanga; trebuie impinsa inapoi la x=0.
    const box = boxForAspect(0.5, 0.05, 0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('moveCropBox', () => {
  const box: CropBox = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };
  it('translates by (dx, dy) without changing size', () => {
    const next = moveCropBox(box, 0.1, -0.1);
    expect(next.x).toBeCloseTo(0.4);
    expect(next.y).toBeCloseTo(0.2);
    expect(next.width).toBe(box.width);
    expect(next.height).toBe(box.height);
  });
  it('clamps so the box never moves past the left/top edge', () => {
    const next = moveCropBox(box, -10, -10);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });
  it('clamps so the box never moves past the right/bottom edge', () => {
    const next = moveCropBox(box, 10, 10);
    expect(next.x + next.width).toBeCloseTo(1);
    expect(next.y + next.height).toBeCloseTo(1);
  });
});

describe('resizeCropFree', () => {
  const box: CropBox = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  it('dragging the se (bottom-right) handle keeps the nw corner (x,y) fixed', () => {
    const next = resizeCropFree(box, 'se', 0.1, 0.1);
    expect(next.x).toBeCloseTo(box.x);
    expect(next.y).toBeCloseTo(box.y);
    expect(next.width).toBeCloseTo(0.5);
    expect(next.height).toBeCloseTo(0.5);
  });
  it('dragging the nw (top-left) handle keeps the opposite (bottom-right) corner fixed', () => {
    const next = resizeCropFree(box, 'nw', -0.1, -0.1);
    expect(next.x + next.width).toBeCloseTo(box.x + box.width);
    expect(next.y + next.height).toBeCloseTo(box.y + box.height);
    expect(next.width).toBeCloseTo(0.5);
    expect(next.height).toBeCloseTo(0.5);
  });
  it('the two axes resize independently (a diagonal drag can distort the aspect ratio freely)', () => {
    const next = resizeCropFree(box, 'se', 0.3, 0.05);
    expect(next.width).toBeCloseTo(0.7);
    expect(next.height).toBeCloseTo(0.45);
  });
  it('never shrinks a dimension below MIN_CROP_SIZE', () => {
    const next = resizeCropFree(box, 'se', -10, -10);
    expect(next.width).toBeCloseTo(MIN_CROP_SIZE);
    expect(next.height).toBeCloseTo(MIN_CROP_SIZE);
  });
  it('never grows past the [0,1] frame', () => {
    const next = resizeCropFree(box, 'nw', -10, -10);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.y).toBeGreaterThanOrEqual(0);
  });
});

describe('resizeCropLocked', () => {
  const box: CropBox = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const normR = 1; // patrat, pentru simplitate — width/height trebuie sa ramana 1:1

  it('a horizontal drag (|dx| >= |dy|) resizes the box', () => {
    const next = resizeCropLocked(box, 'se', 0.1, 0, normR);
    expect(next.width).toBeGreaterThan(box.width);
  });

  // Bug real gasit de ESLint (nu manual, nu de utilizator): o versiune
  // anterioara deriva latimea DOAR din `dx`, ignorand complet `dy` — un drag
  // predominant vertical nu avea niciun efect atunci cand raportul era
  // blocat. Acesta e testul de regresie pentru exact acel bug.
  it('a purely vertical drag (dx=0) still resizes the box (regression: dy used to be ignored entirely)', () => {
    const next = resizeCropLocked(box, 'se', 0, 0.15, normR);
    expect(next.width).toBeGreaterThan(box.width);
    expect(next.height).toBeGreaterThan(box.height);
  });

  it('keeps the exact aspect ratio (width/height === normR) after a resize', () => {
    const next = resizeCropLocked(box, 'se', 0.1, 0.03, normR);
    expect(next.width / next.height).toBeCloseTo(normR);
  });

  it('keeps the aspect ratio for a non-square ratio too', () => {
    const wideR = 16 / 9;
    const next = resizeCropLocked(box, 'se', 0, 0.1, wideR);
    expect(next.width / next.height).toBeCloseTo(wideR);
  });

  it('se: dragging outward keeps the opposite (nw) corner fixed', () => {
    const next = resizeCropLocked(box, 'se', 0.1, 0.1, normR);
    expect(next.x).toBeCloseTo(box.x);
    expect(next.y).toBeCloseTo(box.y);
  });
  it('nw: dragging outward keeps the opposite (se) corner fixed', () => {
    const next = resizeCropLocked(box, 'nw', -0.1, -0.1, normR);
    expect(next.x + next.width).toBeCloseTo(box.x + box.width);
    expect(next.y + next.height).toBeCloseTo(box.y + box.height);
  });
  it('ne: dragging outward keeps the opposite (sw) corner fixed', () => {
    const next = resizeCropLocked(box, 'ne', 0.1, -0.1, normR);
    expect(next.x).toBeCloseTo(box.x);
    expect(next.y + next.height).toBeCloseTo(box.y + box.height);
  });
  it('sw: dragging outward keeps the opposite (ne) corner fixed', () => {
    const next = resizeCropLocked(box, 'sw', -0.1, 0.1, normR);
    expect(next.x + next.width).toBeCloseTo(box.x + box.width);
    expect(next.y).toBeCloseTo(box.y);
  });

  it('scales down uniformly (preserving aspect) instead of clipping just one axis when it would overflow the frame', () => {
    // ancora la (0.25, 0.25); un drag urias ar cere o caseta mult mai mare
    // decat spatiul disponibil pana la marginea cadrului pe ambele axe.
    const next = resizeCropLocked(box, 'se', 10, 10, normR);
    expect(next.width / next.height).toBeCloseTo(normR);
    expect(next.x + next.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(next.y + next.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('never shrinks below MIN_CROP_SIZE on the driving axis', () => {
    const next = resizeCropLocked(box, 'se', -10, -10, normR);
    expect(next.width).toBeGreaterThanOrEqual(MIN_CROP_SIZE - 1e-9);
    expect(next.height).toBeGreaterThanOrEqual(MIN_CROP_SIZE - 1e-9);
  });
});

describe('FULL_CROP', () => {
  it('covers the entire normalized frame', () => {
    expect(FULL_CROP).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});
