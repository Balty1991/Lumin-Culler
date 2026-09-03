import { describe, expect, it } from 'vitest';
import { centerSquare, toTensor } from './clipPreprocess';

/**
 * core/clip/clipPreprocess.test.ts
 *
 * Preprocesarea e locul in care o greseala nu se vede NICIODATA. Modelul
 * primeste un tensor de forma corecta, raspunde cu un vector de forma corecta,
 * si tot ce se construieste peste el e gunoi cu aspect respectabil. De-aia
 * numerele de aici sunt verificabile de mana, nu comparate cu o iesire "de
 * referinta" produsa de acelasi cod.
 */
describe('centerSquare', () => {
  it('pe o poza lata ia patratul din mijloc, nu din stanga', () => {
    expect(centerSquare(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
  });

  it('pe o poza inalta taie sus si jos, egal', () => {
    expect(centerSquare(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });

  it('pe o poza deja patrata nu taie nimic', () => {
    expect(centerSquare(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
  });

  it('la dimensiuni impare da offset intreg, nu fractionar', () => {
    // Un offset fractionar la drawImage introduce inca o interpolare intr-o
    // operatie care ar trebui sa fie o simpla decupare.
    const r = centerSquare(101, 50);
    expect(Number.isInteger(r.sx)).toBe(true);
    expect(Number.isInteger(r.sy)).toBe(true);
    expect(r.size).toBe(50);
  });
});

describe('toTensor', () => {
  const MEAN = [0.5, 0.5, 0.5] as const;
  const STD = [0.5, 0.5, 0.5] as const;

  /** O imagine 2x2 cu patru pixeli distincti, in ordinea RGBA de canvas. */
  const RGBA_2x2 = new Uint8ClampedArray([
    255, 0, 0, 255,   // rosu
    0, 255, 0, 255,   // verde
    0, 0, 255, 255,   // albastru
    255, 255, 255, 255 // alb
  ]);

  it('aseaza canalele in ordinea NCHW, nu intercalat ca in canvas', () => {
    // ASTA e testul care conteaza. Scris intercalat (ca in canvas), modelul
    // primeste ceva ce pentru el e zgomot colorat si raspunde cu un vector
    // care arata perfect normal.
    const t = toTensor(RGBA_2x2, 2, MEAN, STD);
    expect(t.length).toBe(12);
    // Primele 4 = toate valorile ROSII ale celor 4 pixeli.
    expect([...t.slice(0, 4)]).toEqual([1, -1, -1, 1]);
    // Urmatoarele 4 = toate valorile VERZI.
    expect([...t.slice(4, 8)]).toEqual([-1, 1, -1, 1]);
    // Ultimele 4 = toate valorile ALBASTRE.
    expect([...t.slice(8, 12)]).toEqual([-1, -1, 1, 1]);
  });

  it('aplica media si deviatia pe fiecare canal separat', () => {
    // Praguri diferite pe canale ca sa prinda o normalizare care foloseste
    // acelasi numar peste tot (greseala tipica la copiat dintr-un exemplu).
    const t = toTensor(
      new Uint8ClampedArray([255, 255, 255, 255]), 1,
      [0, 0.5, 1], [1, 0.25, 0.5]
    );
    expect(t[0]).toBeCloseTo(1, 6);      // (1 - 0)   / 1
    expect(t[1]).toBeCloseTo(2, 6);      // (1 - 0.5) / 0.25
    expect(t[2]).toBeCloseTo(0, 6);      // (1 - 1)   / 0.5
  });

  it('scaleaza 0..255 la 0..1 inainte de normalizare', () => {
    const t = toTensor(new Uint8ClampedArray([128, 128, 128, 255]), 1, [0, 0, 0], [1, 1, 1]);
    expect(t[0]).toBeCloseTo(128 / 255, 6);
  });

  it('ignora canalul alfa — modelul are trei canale de intrare', () => {
    const opac = toTensor(new Uint8ClampedArray([10, 20, 30, 255]), 1, MEAN, STD);
    const transparent = toTensor(new Uint8ClampedArray([10, 20, 30, 0]), 1, MEAN, STD);
    expect([...opac]).toEqual([...transparent]);
  });

  it('arunca daca primeste mai putini pixeli decat spune dimensiunea', () => {
    // Fara verificare, ar citi `undefined` din capatul tabloului, ar face
    // NaN/255, si ar produce un vector de NaN-uri pe care nimeni nu-l observa.
    expect(() => toTensor(new Uint8ClampedArray(4), 2, MEAN, STD)).toThrow(/astept/);
  });
});
