import { describe, expect, it } from 'vitest';
import { applyHslBands, bandWeights, rgbToHsl, hslToRgb, isNeutralBands, BANDS, NEUTRAL_BAND } from './hslBands';

/** Un singur pixel, ca sa se poata verifica exact ce s-a schimbat. */
function pixel(r: number, g: number, b: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, 255]);
}

describe('conversia intre RGB si HSL', () => {
  it('se intoarce de unde a plecat', () => {
    for (const c of [[200, 40, 40], [40, 200, 90], [30, 80, 220], [128, 128, 128], [0, 0, 0], [255, 255, 255]]) {
      const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
      const back = hslToRgb(h, s, l);
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(1);
    }
  });

  it('griul n-are nuanta si n-are saturatie', () => {
    const [, s] = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
  });
});

describe('cat apartine o nuanta fiecarei game', () => {
  it('centrul unei game ii apartine ei complet', () => {
    expect(bandWeights(0).red).toBeCloseTo(1, 5);
    expect(bandWeights(120).green).toBeCloseTo(1, 5);
    expect(bandWeights(240).blue).toBeCloseTo(1, 5);
  });

  it('trecerea e lina, nu pe felii cu margini', () => {
    // intre verde (120) si turcoaz (180) ponderile se suprapun treptat
    const w = bandWeights(150);
    expect(w.green).toBeGreaterThan(0);
    expect(w.aqua).toBeGreaterThan(0);
    // si nicaieri nu apare un SALT: parcurgem tot cercul si verificam ca doua
    // grade vecine nu difera niciodata mai mult decat o panta lina (o felie cu
    // margini dure ar produce un salt de la 1 la 0 intr-un singur grad)
    let maxSalt = 0;
    for (let h = 0; h < 360; h++) {
      for (const band of BANDS) {
        maxSalt = Math.max(maxSalt, Math.abs(bandWeights(h)[band] - bandWeights((h + 1) % 360)[band]));
      }
    }
    expect(maxSalt).toBeLessThan(0.05);
  });

  it('cercul se inchide: rosul de la 359 e tot rosu', () => {
    expect(bandWeights(359).red).toBeGreaterThan(0.9);
  });
});

describe('reglajul pe game', () => {
  const doar = (band: typeof BANDS[number], v: Partial<typeof NEUTRAL_BAND>) => ({ [band]: { ...NEUTRAL_BAND, ...v } });

  it('scade saturatia DOAR gamei alese', () => {
    const verde = pixel(0, 255, 0);   // chiar in centrul gamei verzi
    const rosu = pixel(200, 40, 40);
    applyHslBands(verde, doar('green', { saturation: -100 }));
    applyHslBands(rosu, doar('green', { saturation: -100 }));
    // verdele curat s-a dus complet la gri
    expect(Math.abs(verde[0] - verde[1])).toBeLessThanOrEqual(1);
    // rosul e neatins
    expect([rosu[0], rosu[1], rosu[2]]).toEqual([200, 40, 40]);
  });

  it('o culoare aflata intre doua game se schimba doar pe jumatate — apartine amandurora', () => {
    // un verde care bate spre turcoaz (nuanta ~139) nu e "verde pur", si nu
    // trebuie tratat ca atare: altfel exact culorile de la granita ar sari
    const intre = pixel(40, 200, 90);
    const s0 = rgbToHsl(intre[0], intre[1], intre[2])[1];
    applyHslBands(intre, doar('green', { saturation: -100 }));
    const s1 = rgbToHsl(intre[0], intre[1], intre[2])[1];
    expect(s1).toBeLessThan(s0);
    expect(s1).toBeGreaterThan(0);
  });

  it('lumineaza si intuneca gama aleasa', () => {
    const sus = pixel(30, 80, 220), jos = pixel(30, 80, 220);
    applyHslBands(sus, doar('blue', { luminance: 100 }));
    applyHslBands(jos, doar('blue', { luminance: -100 }));
    const lum = (p: Uint8ClampedArray) => p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
    expect(lum(sus)).toBeGreaterThan(lum(jos));
  });

  it('roteste nuanta', () => {
    const p = pixel(40, 200, 90);
    const inainte = rgbToHsl(p[0], p[1], p[2])[0];
    applyHslBands(p, doar('green', { hue: 100 }));
    expect(rgbToHsl(p[0], p[1], p[2])[0]).toBeGreaterThan(inainte);
  });

  it('nu atinge pixelii aproape gri — acolo nuanta e zgomot', () => {
    // zapada, asfalt, un perete alb: acolo o pata colorata ar sari in ochi
    const gri = pixel(129, 128, 127);
    applyHslBands(gri, doar('red', { saturation: 100 }));
    expect([gri[0], gri[1], gri[2]]).toEqual([129, 128, 127]);
  });

  it('saturatia se inmulteste, nu se aduna', () => {
    // o culoare deja slaba nu trebuie sa sara mai tare decat una vie
    const slaba = pixel(140, 120, 120);
    const vie = pixel(230, 20, 20);
    const dS = (p: Uint8ClampedArray) => { const s0 = rgbToHsl(p[0],p[1],p[2])[1]; applyHslBands(p, doar('red', { saturation: 50 })); return rgbToHsl(p[0],p[1],p[2])[1] - s0; };
    expect(dS(slaba)).toBeLessThan(dS(vie));
  });

  it('fara reglaje nu schimba niciun pixel', () => {
    const p = pixel(200, 40, 40);
    applyHslBands(p, {});
    applyHslBands(p, { red: NEUTRAL_BAND });
    expect([p[0], p[1], p[2]]).toEqual([200, 40, 40]);
    expect(isNeutralBands(undefined)).toBe(true);
    expect(isNeutralBands({ red: NEUTRAL_BAND })).toBe(true);
    expect(isNeutralBands({ red: { ...NEUTRAL_BAND, hue: 5 } })).toBe(false);
  });

  it('toate cele opt game au un centru propriu si sunt distincte', () => {
    const centre = BANDS.map(b => {
      for (let h = 0; h < 360; h++) if (bandWeights(h)[b] > 0.999) return h;
      return -1;
    });
    expect(centre.every(c => c >= 0)).toBe(true);
    expect(new Set(centre).size).toBe(BANDS.length);
  });
});
