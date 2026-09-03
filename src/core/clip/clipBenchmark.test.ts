import { describe, expect, it } from 'vitest';
import { median, summarizeBenchmark } from './clipBenchmark';

/**
 * core/clip/clipBenchmark.test.ts
 * Masuratoarea care hotaraste daca functia merita sa existe. Daca ea minte,
 * decizia se ia pe o cifra falsa — deci partea care aduna si imparte se
 * verifica cu numere scrise de mana.
 */
describe('median', () => {
  it('la un numar impar ia valoarea din mijloc', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('la un numar par face media celor doua din mijloc', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('un set gol da zero, nu NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('summarizeBenchmark', () => {
  it('foloseste MEDIANA, nu media — prima poza plateste incalzirea', () => {
    // 400 ms la prima poza (compilare de shadere), apoi 20 ms constant.
    // Media ar spune 83 ms si ar descrie un cost pe care nu-l mai plateste
    // nicio poza urmatoare; mediana spune 20.
    const r = summarizeBenchmark('webgpu', 3000, [400, 20, 20, 20, 20])!;
    expect(r.medianMs).toBe(20);
    expect(r.slowestMs).toBe(400);
  });

  it('traduce mediana in cifra care chiar conteaza: un lot de o mie de poze', () => {
    const r = summarizeBenchmark('webgpu', 1000, [25, 25, 25])!;
    expect(r.thousandPhotosSeconds).toBe(25);
  });

  it('pastreaza backend-ul chiar folosit, nu pe cel dorit', () => {
    // Un rezultat de pe wasm citit ca si cum ar fi de pe WebGPU ar face
    // functia sa para de trei ori mai lenta decat e pe telefoanele bune.
    expect(summarizeBenchmark('wasm', 100, [200])!.backend).toBe('wasm');
  });

  it('fara nicio masuratoare nu inventeaza un rezultat', () => {
    expect(summarizeBenchmark('webgpu', 1000, [])).toBeNull();
  });

  it('numara cate poze au stat la baza cifrei', () => {
    expect(summarizeBenchmark('webgpu', 1, [1, 2, 3])!.samples).toBe(3);
  });
});
