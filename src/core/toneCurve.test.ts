import { describe, it, expect } from 'vitest';
import {
  evaluateCurve, buildCurveLut, buildChannelLuts, isLinearCurve, hasNoCurves,
  addCurvePoint, moveCurvePoint, removeCurvePoint, findCurvePoint,
  LINEAR_CURVE, MAX_CURVE_POINTS, CURVE_PRESETS, type CurvePoint
} from './toneCurve';

describe('curba tonala', () => {
  it('curba liniara nu schimba nimic', () => {
    expect(isLinearCurve(LINEAR_CURVE)).toBe(true);
    expect(isLinearCurve(undefined)).toBe(true);
    const lut = buildCurveLut(LINEAR_CURVE);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });

  it('trece exact prin punctele de control', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }];
    expect(evaluateCurve(pts, 0)).toBeCloseTo(0, 5);
    expect(evaluateCurve(pts, 0.5)).toBeCloseTo(0.75, 5);
    expect(evaluateCurve(pts, 1)).toBeCloseTo(1, 5);
  });

  it('ramane monotona: ridicarea umbrelor nu intuneca nicaieri', () => {
    // exact cazul care rupe un spline natural — vezi comentariul din toneCurve.ts
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.25, y: 0.5 }, { x: 0.3, y: 0.52 }, { x: 1, y: 1 }];
    const lut = buildCurveLut(pts);
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it('nu iese niciodata din 0..255, oricat de agresive ar fi punctele', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 1 }, { x: 0.2, y: 0 }, { x: 0.8, y: 1 }, { x: 1, y: 0 }];
    const lut = buildCurveLut(pts);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  it('se prelungeste orizontal in afara punctelor (negru ridicat)', () => {
    const pts: CurvePoint[] = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.9 }];
    expect(evaluateCurve(pts, 0)).toBeCloseTo(0.3, 5);
    expect(evaluateCurve(pts, 1)).toBeCloseTo(0.9, 5);
  });

  it('LUT-urile de canal compun master-ul peste canalele individuale', () => {
    const luts = buildChannelLuts({
      master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }]
    });
    expect(luts).not.toBeNull();
    // rosul e intai coborat de curba lui, apoi ridicat de master
    const doarMaster = buildCurveLut([{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }]);
    const doarRosu = buildCurveLut([{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }]);
    expect(luts!.r[128]).toBe(doarMaster[doarRosu[128]]);
    // verdele nu are curba proprie: doar master
    expect(luts!.g[128]).toBe(doarMaster[128]);
  });

  it('intoarce null cand nicio curba nu schimba nimic — apelantul sare pasul', () => {
    expect(buildChannelLuts(undefined)).toBeNull();
    expect(buildChannelLuts({})).toBeNull();
    expect(buildChannelLuts({ master: LINEAR_CURVE })).toBeNull();
    expect(hasNoCurves({ master: LINEAR_CURVE, red: LINEAR_CURVE })).toBe(true);
  });

  it('adaugarea refuza punctele prea apropiate si respecta maximul', () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(addCurvePoint(base, { x: 0.01, y: 0.5 })).toHaveLength(2);
    expect(addCurvePoint(base, { x: 0.5, y: 0.6 })).toHaveLength(3);
    let many = base;
    for (let i = 1; i < 20; i++) many = addCurvePoint(many, { x: i / 20, y: i / 20 });
    expect(many.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
  });

  it('un punct mutat nu poate trece peste vecinii lui', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    const stanga = moveCurvePoint(pts, 1, { x: -1, y: 0.2 });
    expect(stanga[1].x).toBeGreaterThan(stanga[0].x);
    const dreapta = moveCurvePoint(pts, 1, { x: 2, y: 0.9 });
    expect(dreapta[1].x).toBeLessThan(dreapta[2].x);
    // ordinea ramane crescatoare, deci curba ramane o functie
    expect(dreapta.map(p => p.x)).toEqual([...dreapta.map(p => p.x)].sort((a, b) => a - b));
  });

  it('nu se pot sterge ultimele doua puncte', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(removeCurvePoint(pts, 1)).toHaveLength(2);
    expect(removeCurvePoint(removeCurvePoint(pts, 1), 0)).toHaveLength(2);
  });

  it('gaseste punctul de sub deget si ignora restul', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(findCurvePoint(pts, 0.52, 0.48, 0.08)).toBe(1);
    expect(findCurvePoint(pts, 0.3, 0.8, 0.08)).toBe(-1);
  });

  it('fiecare presetare produce o curba monotona si valida', () => {
    for (const preset of CURVE_PRESETS) {
      for (const ch of ['master', 'red', 'green', 'blue'] as const) {
        const pts = preset.curves[ch];
        if (!pts) continue;
        const lut = buildCurveLut(pts);
        for (let i = 1; i < 256; i++) {
          expect(lut[i], `${preset.key}/${ch} la ${i}`).toBeGreaterThanOrEqual(lut[i - 1]);
        }
      }
    }
  });

  it('cache-ul de LUT-uri nu tine minte curba gresita cand se schimba', () => {
    const a = buildChannelLuts({ master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] })!;
    const valA = a.r[128];
    const b = buildChannelLuts({ master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 1 }] })!;
    expect(b.r[128]).not.toBe(valA);
    // aceeasi curba, a doua oara: acelasi rezultat
    const c = buildChannelLuts({ master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] })!;
    expect(c.r[128]).toBe(valA);
    // si o curba pe alt canal schimba rezultatul, desi master-ul e identic
    const d = buildChannelLuts({
      master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 1 }]
    })!;
    expect(d.r[128]).not.toBe(valA);
  });

  it('presetarea "faded" chiar ridica negrul si tempereaza albul', () => {
    const faded = CURVE_PRESETS.find(p => p.key === 'faded')!;
    const lut = buildCurveLut(faded.curves.master);
    expect(lut[0]).toBeGreaterThan(20);
    expect(lut[255]).toBeLessThan(250);
  });
});
