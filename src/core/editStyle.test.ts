import { describe, it, expect } from 'vitest';
import {
  styleDelta, foldStyleSample, applyStyle, styleIsReady, EMPTY_STYLE,
  STYLE_MIN_SAMPLES, STYLE_MAX_DELTA
} from './editStyle';
import { NEUTRAL_ADJUSTMENTS, type EditAdjustments } from './imageAdjust';

const adj = (over: Partial<EditAdjustments> = {}): EditAdjustments => ({ ...NEUTRAL_ADJUSTMENTS, ...over });

describe('styleDelta: ce e stil si ce e nevoia pozei', () => {
  it('scade ce facuse Auto — poza intunecata nu devine "stil"', () => {
    // Auto a pus +30 fiindca poza era subexpusa. Omul a lasat exact 30. N-a
    // adaugat nimic al lui, deci nu e nimic de invatat.
    expect(styleDelta(adj({ exposure: 30 }), adj({ exposure: 30 }))).toEqual({});
  });

  it('retine doar ce a pus omul peste Auto', () => {
    const d = styleDelta(adj({ exposure: 30, contrast: 8 }), adj({ exposure: 30 }));
    expect(d).toEqual({ contrast: 8 });
  });

  it('ignora micarile sub o unitate', () => {
    // Un slider atins din greseala cu degetul nu e o preferinta.
    expect(styleDelta(adj({ contrast: 0.4 }), adj())).toEqual({});
  });
});

describe('profilul se strange in timp', () => {
  it('sliderele neatinse trag media in jos, nu se sar', () => {
    // Altfel o singura poza cu contrast impins ar ramane media pe veci.
    let p = foldStyleSample(EMPTY_STYLE, { contrast: 20 });
    expect(p.deltas.contrast).toBe(20);
    p = foldStyleSample(p, {});
    expect(p.deltas.contrast).toBe(10);
    p = foldStyleSample(p, {});
    expect(p.deltas.contrast).toBeCloseTo(6.7, 1);
  });

  it('nu se aplica nimic sub pragul de poze', () => {
    let p = EMPTY_STYLE;
    for (let i = 0; i < STYLE_MIN_SAMPLES - 1; i++) p = foldStyleSample(p, { contrast: 10 });
    expect(styleIsReady(p)).toBe(false);
    expect(applyStyle(adj({ contrast: 5 }), p)).toEqual(adj({ contrast: 5 }));
  });
});

describe('applyStyle', () => {
  const ready = () => {
    let p = EMPTY_STYLE;
    for (let i = 0; i < STYLE_MIN_SAMPLES; i++) p = foldStyleSample(p, { contrast: 10, temperature: -6 });
    return p;
  };

  it('adauga peste Auto, nu inlocuieste', () => {
    const out = applyStyle(adj({ contrast: 5, exposure: 12 }), ready());
    expect(out.contrast).toBe(15);
    expect(out.temperature).toBe(-6);
    expect(out.exposure).toBe(12); // neatins de stil, ramane ce a zis Auto
  });

  it('nu iese din scala sliderului', () => {
    const out = applyStyle(adj({ contrast: 95 }), ready());
    expect(out.contrast).toBe(100);
  });

  it('un stil extrem e plafonat', () => {
    // Treizeci de poze de concert impinse tare n-au voie sa distruga o poza normala.
    let p = EMPTY_STYLE;
    for (let i = 0; i < 10; i++) p = foldStyleSample(p, { contrast: 90 });
    expect(applyStyle(adj(), p).contrast).toBe(STYLE_MAX_DELTA);
  });

  it('nu atinge decuparea si rotatia', () => {
    // Un stil de recadrare aplicat orbeste taie capete de oameni.
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const out = applyStyle(adj({ crop, rotationDeg: 3 }), ready());
    expect(out.crop).toEqual(crop);
    expect(out.rotationDeg).toBe(3);
  });
});
