import { describe, expect, it, vi } from 'vitest';
import { parseClipManifest, readClipManifest, clipModelUrl, CLIP_MANIFEST_URL, type ClipManifest } from './clipManifest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * core/clip/clipManifest.test.ts
 *
 * Manifestul e contractul dintre ce a pus CI-ul langa aplicatie si ce crede
 * aplicatia ca are. Un manifest acceptat pe jumatate e mai rau decat unul
 * lipsa: lipsa inseamna "functia nu exista" (o stare testata zilnic, e chiar
 * aplicatia de azi), pe cand jumatate inseamna vectori calculati gresit.
 */
const VALID: ClipManifest = {
  id: 'mobileclip_s0.image.q8@a1b2c3d4e5f6',
  dim: 512, inputSize: 256,
  mean: [0, 0, 0], std: [1, 1, 1],
  file: 'model.onnx', bytes: 12_345_678
};

describe('parseClipManifest', () => {
  it('accepta un manifest complet', () => {
    expect(parseClipManifest(VALID)).toEqual(VALID);
  });

  it.each([
    ['fara id', { ...VALID, id: '' }],
    ['fara fisier', { ...VALID, file: '' }],
    ['dim zero', { ...VALID, dim: 0 }],
    ['dim fractionar', { ...VALID, dim: 511.5 }],
    ['inputSize negativ', { ...VALID, inputSize: -1 }],
    ['bytes zero', { ...VALID, bytes: 0 }],
    ['mean cu doua valori', { ...VALID, mean: [0, 0] }],
    ['std cu text', { ...VALID, std: ['1', 1, 1] }],
    ['nu e obiect', 'model.onnx'],
    ['null', null]
  ])('respinge un manifest %s', (_nume, intrare) => {
    expect(parseClipManifest(intrare)).toBeNull();
  });

  it('respinge o deviatie standard de ZERO', () => {
    // Ar da impartire la zero in preprocesare: Infinity in tensor, si un vector
    // de NaN-uri la iesire — care s-ar stoca si compara ca oricare altul.
    expect(parseClipManifest({ ...VALID, std: [1, 0, 1] })).toBeNull();
  });
});

describe('readClipManifest', () => {
  it('intoarce null cand fisierul lipseste — starea normala, nu o eroare', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    expect(await readClipManifest(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('intoarce null cand reteaua arunca', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await readClipManifest(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('intoarce null pe JSON stricat, in loc sa arunce in ecranul care intreaba', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('json')) });
    expect(await readClipManifest(fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('citeste de la adresa asteptata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => VALID });
    await readClipManifest(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(CLIP_MANIFEST_URL);
  });
});

describe('clipModelUrl', () => {
  it('compune adresa modelului langa manifest', () => {
    expect(clipModelUrl(VALID)).toBe('/models/clip/model.onnx');
  });
});

describe('reteta din scripts/clip-model.json', () => {
  const cale = resolve(__dirname, '..', '..', '..', 'scripts', 'clip-model.json');

  it('exista si descrie complet modelul adus la build', () => {
    // Fisierul asta e singurul loc in care traiesc constantele riscante
    // (preprocesarea). Daca dispare sau ramane incomplet, CI-ul ar aduce un
    // model pe care aplicatia l-ar folosi cu numere gresite.
    expect(existsSync(cale)).toBe(true);
    const reteta = JSON.parse(readFileSync(cale, 'utf8'));
    for (const camp of ['name', 'url', 'dim', 'inputSize', 'mean', 'std', 'minBytes', 'maxBytes']) {
      expect(reteta[camp], `lipseste "${camp}"`).toBeDefined();
    }
    expect(reteta.mean).toHaveLength(3);
    expect(reteta.std).toHaveLength(3);
    expect(reteta.std.every((s: number) => s !== 0)).toBe(true);
  });

  it('NU contine un id scris de mana — el se calculeaza din continutul fisierului', () => {
    // Un id scris de mana trebuie tinut minte si incrementat; unul derivat din
    // sha256 se schimba singur la orice modificare a modelului, iar vectorii
    // vechi devin automat recunoscut-straini.
    const reteta = JSON.parse(readFileSync(cale, 'utf8'));
    expect(reteta.id).toBeUndefined();
  });
});

describe('adresele se calculeaza din BASE_URL, nu sunt scrise absolut', () => {
  // Bug real, facut si reparat in aceeasi sesiune: `/models/clip/` merge in
  // dezvoltare (aplicatia sta in radacina) si cauta in gol pe GitHub Pages,
  // unde site-ul e servit din /Lumin-Culler/. Esecul e inselator: manifestul
  // "lipseste", functia se dezactiveaza singura exact cum e proiectata s-o
  // faca, si nimic nu pare stricat — desi fisierul chiar e livrat.
  //
  // Testul citeste SURSA, nu valoarea: sub vitest BASE_URL e "/", deci
  // constanta ar arata identic si scrisa gresit.
  const sursa = readFileSync(resolve(__dirname, 'clipManifest.ts'), 'utf8');

  it('CLIP_BASE_PATH pleaca de la BASE_URL', () => {
    expect(sursa).toMatch(/CLIP_BASE_PATH = `\$\{import\.meta\.env\.BASE_URL\}/);
  });

  it('ORT_WASM_PATH pleaca de la BASE_URL', () => {
    expect(sursa).toMatch(/ORT_WASM_PATH = `\$\{import\.meta\.env\.BASE_URL\}/);
  });

  it('nicio constanta nu incepe cu o cale absoluta scrisa de mana', () => {
    expect(sursa).not.toMatch(/^export const \w+ = '\//m);
  });

  it('workerul nu scrie nici el calea wasm absolut', () => {
    const worker = readFileSync(resolve(__dirname, '..', '..', 'workers', 'clipEmbed.worker.ts'), 'utf8');
    expect(worker).toContain('ORT_WASM_PATH');
    expect(worker).not.toContain("wasmPaths = '/ort/'");
  });
});
