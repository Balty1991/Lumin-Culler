import { describe, expect, it } from 'vitest';
import { PRESETS, applyPreset } from './editPresets';
import { NEUTRAL_ADJUSTMENTS, type EditAdjustments } from './imageAdjust';

const cuMunca: EditAdjustments = {
  ...NEUTRAL_ADJUSTMENTS,
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  rotationDeg: 1.4,
  heal: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.04 }],
  controlPoints: [{ id: 'p1', x: 0.3, y: 0.3, radius: 0.2, brightness: 20, contrast: 0, saturation: 0, structure: 0 }],
  curves: undefined
};

describe('stilurile gata facute', () => {
  it('NU ating decuparea, indreptarea, punctele de control sau petele vindecate', () => {
    // Alea sunt munca ta pe ACEASTA poza; un stil e despre culori si tonuri.
    for (const preset of PRESETS) {
      const r = applyPreset(cuMunca, preset);
      expect(r.crop).toEqual(cuMunca.crop);
      expect(r.rotationDeg).toBe(cuMunca.rotationDeg);
      expect(r.heal).toEqual(cuMunca.heal);
      expect(r.controlPoints).toEqual(cuMunca.controlPoints);
    }
  });

  it('doua stiluri apasate la rand nu se aduna', () => {
    // Altfel a doua apasare ar dubla contrastul si ar arde poza.
    const unul = applyPreset(NEUTRAL_ADJUSTMENTS, PRESETS[0]);
    const dupaDoua = applyPreset(unul, PRESETS[0]);
    expect(dupaDoua.contrast).toBe(unul.contrast);
  });

  it('trecerea la alt stil sterge complet urmele celui dinainte', () => {
    const alb_negru = applyPreset(NEUTRAL_ADJUSTMENTS, PRESETS.find(p => p.key === 'bw')!);
    expect(alb_negru.saturation).toBe(-100);
    const portret = applyPreset(alb_negru, PRESETS.find(p => p.key === 'portrait')!);
    // saturatia nu ramane la -100 doar fiindca portretul n-o pomeneste
    expect(portret.saturation).toBe(0);
    // si nici reglajele pe game ale stilului vechi
    expect(applyPreset(portret, PRESETS.find(p => p.key === 'natural')!).hsl).toBeUndefined();
  });

  it('fiecare stil chiar face ceva', () => {
    for (const preset of PRESETS) {
      const r = applyPreset(NEUTRAL_ADJUSTMENTS, preset);
      const schimbat = Object.keys(preset.style).length > 0
        && JSON.stringify({ ...r, hsl: r.hsl }) !== JSON.stringify({ ...NEUTRAL_ADJUSTMENTS, hsl: undefined });
      expect(schimbat, preset.key).toBe(true);
    }
  });

  it('niciun stil nu duce un slider la capat, in afara de alb-negru', () => {
    // Un stil care sare in ochi de la prima apasare arata bine intr-o captura
    // si prost pe patruzeci de poze la rand.
    for (const preset of PRESETS.filter(p => p.key !== 'bw')) {
      for (const [k, v] of Object.entries(preset.style)) {
        if (typeof v === 'number') expect(Math.abs(v), `${preset.key}.${k}`).toBeLessThanOrEqual(30);
      }
    }
  });

  it('cheile sunt unice', () => {
    expect(new Set(PRESETS.map(p => p.key)).size).toBe(PRESETS.length);
  });
});
