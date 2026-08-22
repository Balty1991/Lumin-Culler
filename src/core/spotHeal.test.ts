import { describe, it, expect } from 'vitest';
import { buildStrokeMask, findBestSourceOffset, applyHealStroke, applyHealStrokes, type HealStroke } from './spotHeal';

/** Fundal uniform cu un mic zgomot determinist — ca o textura reala, nu o suprafata plata. */
function fundal(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = ((x * 7 + y * 13) % 11) - 5;
      d[i] = 140 + n; d[i + 1] = 150 + n; d[i + 2] = 130 + n; d[i + 3] = 255;
    }
  }
  return d;
}

/** Pune o pata rosie in (cx, cy). */
function pata(d: Uint8ClampedArray, w: number, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * w + x) * 4;
      d[i] = 230; d[i + 1] = 40; d[i + 2] = 40;
    }
  }
}

describe('vindecarea petelor', () => {
  it('masca e plina in centru si se stinge spre margine', () => {
    const stroke: HealStroke = { points: [{ x: 0.5, y: 0.5 }], radius: 0.1 };
    const r = buildStrokeMask(stroke, 100, 100)!;
    const w = r.x1 - r.x0;
    const centru = r.mask[(50 - r.y0) * w + (50 - r.x0)];
    expect(centru).toBeCloseTo(1, 2);
    // exact pe raza: zero
    const peRaza = r.mask[(50 - r.y0) * w + (50 - r.x0 + 10)];
    expect(peRaza).toBeLessThan(0.05);
  });

  it('o tusa fara puncte nu produce nicio masca', () => {
    expect(buildStrokeMask({ points: [], radius: 0.05 }, 100, 100)).toBeNull();
  });

  it('cercurile unei tuse se unesc, nu se aduna peste 1', () => {
    const stroke: HealStroke = { points: [{ x: 0.4, y: 0.5 }, { x: 0.42, y: 0.5 }, { x: 0.44, y: 0.5 }], radius: 0.08 };
    const r = buildStrokeMask(stroke, 100, 100)!;
    for (let i = 0; i < r.mask.length; i++) expect(r.mask[i]).toBeLessThanOrEqual(1);
  });

  it('sterge pata: culoarea straina dispare din zona', () => {
    const w = 120, h = 120;
    const d = fundal(w, h);
    pata(d, w, 60, 60, 5);
    const iCentru = (60 * w + 60) * 4;
    expect(d[iCentru]).toBe(230);

    const ok = applyHealStroke(d, w, h, { points: [{ x: 0.5, y: 0.5 }], radius: 0.06 });
    expect(ok).toBe(true);
    // rosul a plecat, iar pixelul seamana cu fundalul
    expect(d[iCentru]).toBeLessThan(170);
    expect(Math.abs(d[iCentru] - 140)).toBeLessThan(15);
    expect(Math.abs(d[iCentru + 1] - 150)).toBeLessThan(15);
  });

  it('nu atinge nimic in afara tusei', () => {
    const w = 120, h = 120;
    const d = fundal(w, h);
    pata(d, w, 60, 60, 5);
    const inainte = d.slice();
    applyHealStroke(d, w, h, { points: [{ x: 0.5, y: 0.5 }], radius: 0.06 });
    const iDeparte = (10 * w + 10) * 4;
    expect(d[iDeparte]).toBe(inainte[iDeparte]);
    expect(d[iDeparte + 1]).toBe(inainte[iDeparte + 1]);
    expect(d[iDeparte + 2]).toBe(inainte[iDeparte + 2]);
  });

  it('peticul se citeste din original, deci pata nu se intinde cand sursa se suprapune', () => {
    const w = 100, h = 100;
    const d = fundal(w, h);
    pata(d, w, 50, 50, 4);
    applyHealStroke(d, w, h, { points: [{ x: 0.5, y: 0.5 }], radius: 0.05 });
    // niciun pixel din imagine nu mai are semnatura petei
    let rosii = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80) rosii++;
    expect(rosii).toBe(0);
  });

  it('o pata fix in colt nu poate fi vindecata, si o spune', () => {
    const w = 60, h = 60;
    const d = fundal(w, h);
    // Raza atat de mare incat TOATE inelele de cautare cad in afara imaginii.
    // 0.45 nu mai ajunge de cand exista si un inel apropiat (1.15 raze): la o
    // pata din colt, acela chiar incape, iar unealta o vindeca — o imbunatatire,
    // nu o regresie. Cazul imposibil ramane cel in care pata e cat toata poza.
    const ok = applyHealStroke(d, w, h, { points: [{ x: 0.02, y: 0.02 }], radius: 0.9 });
    expect(ok).toBe(false);
  });

  /**
   * Diferenta dintre "clone stamp" si "healing": peticul trebuie sa intre in
   * tonul locului in care ajunge, nu sa aduca tonul de unde a fost luat.
   */
  it('muta tonul peticului ca sa se potriveasca cu zona in care intra', () => {
    const w = 80, h = 80;
    const d = new Uint8ClampedArray(w * h * 4);
    // gradient pe orizontala: stanga inchisa, dreapta deschisa
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = 40 + Math.round((x / (w - 1)) * 170);
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    // pata neagra la dreapta, unde fundalul e deschis
    const cx = 60, cy = 40, r = 5;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const i = (y * w + x) * 4;
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
      }
    }
    const vecin = d[(cy * w + (cx + 12)) * 4];
    applyHealStroke(d, w, h, { points: [{ x: cx / w, y: cy / h }], radius: (r + 2) / w });
    const dupa = d[(cy * w + cx) * 4];
    // vindecat: nu mai e negru, si e in tonul vecinilor de pe acelasi gradient
    expect(dupa).toBeGreaterThan(120);
    expect(Math.abs(dupa - vecin)).toBeLessThan(40);
  });

  it('mai multe tuse se aplica una dupa alta', () => {
    const w = 140, h = 140;
    const d = fundal(w, h);
    pata(d, w, 40, 40, 4);
    pata(d, w, 100, 100, 4);
    applyHealStrokes(d, w, h, [
      { points: [{ x: 40 / 140, y: 40 / 140 }], radius: 0.05 },
      { points: [{ x: 100 / 140, y: 100 / 140 }], radius: 0.05 }
    ]);
    let rosii = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80) rosii++;
    expect(rosii).toBe(0);
  });

  it('lista goala de tuse nu schimba nimic', () => {
    const w = 40, h = 40;
    const d = fundal(w, h);
    const inainte = d.slice();
    applyHealStrokes(d, w, h, undefined);
    applyHealStrokes(d, w, h, []);
    expect(Array.from(d)).toEqual(Array.from(inainte));
  });

  it('cauta peticul pe un inel, nu peste pata insasi', () => {
    const w = 100, h = 100;
    const d = fundal(w, h);
    const region = buildStrokeMask({ points: [{ x: 0.5, y: 0.5 }], radius: 0.06 }, w, h)!;
    const off = findBestSourceOffset(d, w, h, region)!;
    expect(off).not.toBeNull();
    expect(Math.abs(off.dx) + Math.abs(off.dy)).toBeGreaterThan(0);
  });
});
