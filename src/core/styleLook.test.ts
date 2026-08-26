import { describe, it, expect } from 'vitest';
import { measureStyleSignals, computeStyleLook, addStyleLook } from './styleLook';

/**
 * "Stil" e butonul separat de Auto, adaugat dupa ce utilizatorul a spus ca
 * "functia auto nu aduce mari imbunatatiri". Constatarea era corecta, dar
 * cauza nu era o defectiune: Auto REPARA, iar pe o poza de telefon deja
 * prelucrata de camera adesea n-are ce repara. Ce lipsea era un look.
 *
 * Regula pe care o apara testele de aici: stilul se MASOARA din poza. O poza
 * plata primeste mult, una deja contrastanta si vie primeste putin. Un stil
 * care ar adauga mereu aceleasi valori ar arde exact pozele bune.
 */

/** ImageData de test — functiile citesc doar data/width/height. */
function img(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

const plata = img(64, 64, () => [138, 143, 146]);
const contrastanta = img(64, 64, (x) => (x % 2 ? [250, 250, 250] : [12, 12, 12]));
const colorata = img(64, 64, (x) => (x % 2 ? [230, 20, 20] : [20, 20, 210]));
const spalata = img(64, 64, () => [110, 110, 110]);

describe('masuratorile stilului', () => {
  it('vede cadrul plat ca avand contrast local aproape zero', () => {
    expect(measureStyleSignals(plata).microContrast).toBeLessThan(1);
  });

  it('vede textura acolo unde chiar exista', () => {
    expect(measureStyleSignals(contrastanta).microContrast).toBeGreaterThan(100);
  });

  it('vede culoarea ca saturatie, si griul ca lipsa ei', () => {
    expect(measureStyleSignals(colorata).saturation).toBeGreaterThan(0.7);
    expect(measureStyleSignals(plata).saturation).toBeLessThan(0.1);
  });

  it('gaseste negrul ridicat al unei poze spalate', () => {
    expect(measureStyleSignals(spalata).blackPoint).toBeGreaterThan(100);
    expect(measureStyleSignals(contrastanta).blackPoint).toBeLessThan(30);
  });
});

describe('cat stil primeste fiecare poza', () => {
  it('da mult unei poze plate — acolo chiar se vede', () => {
    const s = computeStyleLook(plata);
    expect(s.clarity).toBeGreaterThanOrEqual(30);
    expect(s.saturation).toBeGreaterThanOrEqual(15);
  });

  it('da putin uneia deja contrastante — altfel ar arde-o', () => {
    const s = computeStyleLook(contrastanta);
    expect(s.clarity).toBeLessThanOrEqual(10);
    expect(s.contrast).toBeLessThanOrEqual(5);
  });

  it('asaza negrul mai tare cand poza e spalata decat cand nu e', () => {
    expect(computeStyleLook(spalata).blacks).toBeLessThan(computeStyleLook(contrastanta).blacks);
  });

  it('nu scade niciodata claritatea sau culoarea — e un plus, nu o corectie', () => {
    for (const d of [plata, contrastanta, colorata, spalata]) {
      const s = computeStyleLook(d);
      expect(s.clarity).toBeGreaterThan(0);
      expect(s.contrast).toBeGreaterThan(0);
      expect(s.saturation).toBeGreaterThan(0);
      expect(s.blacks).toBeLessThan(0);
    }
  });
});

describe('cum se adauga peste ce e deja pus', () => {
  it('nu sterge reglajele facute de mana', () => {
    const cu = addStyleLook({ clarity: 0, contrast: 0, saturation: 0, blacks: 0, exposure: 40 }, computeStyleLook(plata));
    expect(cu.exposure).toBe(40);
  });

  it('se aduna, deci a doua apasare da mai mult', () => {
    const look = { clarity: 20, contrast: 8, saturation: 10, blacks: -6, grade: 10, grain: 5 };
    const o = addStyleLook({ clarity: 0, contrast: 0, saturation: 0, blacks: 0 }, look);
    const doua = addStyleLook(o, look);
    expect(doua.clarity).toBe(40);
    expect(doua.blacks).toBe(-12);
  });

  it('se opreste la capatul sliderului, nu trece de el', () => {
    const o = addStyleLook({ clarity: 95, contrast: 98, saturation: 0, blacks: -97, grade: 96, grain: 0 },
      { clarity: 30, contrast: 12, saturation: 0, blacks: -14, grade: 30, grain: 0 });
    expect(o.clarity).toBe(100);
    expect(o.contrast).toBe(100);
    expect(o.blacks).toBe(-100);
    expect(o.grade).toBe(100);
  });
});
