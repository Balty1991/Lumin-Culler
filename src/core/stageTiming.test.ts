import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  record, timed, timedSync, readStageStats, resetStageStats, flush,
  __resetMemoryForTests, SAMPLE_CAP
} from './stageTiming';

describe('stageTiming', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetMemoryForTests();
  });

  it('fara masuratori nu raporteaza nicio etapa', () => {
    expect(readStageStats()).toEqual([]);
  });

  it('aduna numar, total si medie per etapa', () => {
    record('decode', 100);
    record('decode', 200);
    record('decode', 300);
    const [s] = readStageStats();
    expect(s.stage).toBe('decode');
    expect(s.count).toBe(3);
    expect(s.totalMs).toBe(600);
    expect(s.avgMs).toBe(200);
  });

  it('raporteaza etapele in ordinea din pipeline, nu in ordinea masurarii', () => {
    record('persist', 1);
    record('decode', 1);
    record('analysis', 1);
    expect(readStageStats().map(s => s.stage)).toEqual(['decode', 'analysis', 'persist']);
  });

  it('mediana si p90 reflecta distributia, nu doar media', () => {
    // 99 de valori mici si una uriasa: media minte, p90 si maximul nu
    for (let i = 0; i < 99; i++) record('analysis', 10);
    record('analysis', 5000);
    const [s] = readStageStats();
    expect(s.p50Ms).toBe(10);
    expect(s.avgMs).toBeGreaterThan(10);
    expect(Math.max(...[s.p50Ms, s.p90Ms])).toBeLessThanOrEqual(5000);
  });

  it('esantionul ramane marginit oricat s-ar masura', () => {
    for (let i = 0; i < SAMPLE_CAP * 10; i++) record('exif', i);
    const [s] = readStageStats();
    expect(s.count).toBe(SAMPLE_CAP * 10);
    // p50/p90 exista si sunt in intervalul masurat, fara ca memoria sa creasca
    expect(s.p50Ms).toBeGreaterThanOrEqual(0);
    expect(s.p90Ms).toBeLessThan(SAMPLE_CAP * 10);
    const raw = JSON.parse(localStorage.getItem('lumin-stage-timing') ?? '{}');
    flush();
    const after = JSON.parse(localStorage.getItem('lumin-stage-timing') ?? '{}');
    expect((after.exif?.sample ?? raw.exif?.sample ?? []).length).toBeLessThanOrEqual(SAMPLE_CAP);
  });

  it('ignora durate imposibile in loc sa le contorizeze', () => {
    record('decode', -5);
    record('decode', Number.NaN);
    record('decode', Number.POSITIVE_INFINITY);
    expect(readStageStats()).toEqual([]);
  });

  it('timed() masoara si intoarce rezultatul', async () => {
    const out = await timed('analysis', async () => 'gata');
    expect(out).toBe('gata');
    expect(readStageStats()[0].count).toBe(1);
  });

  it('timed() inregistreaza si cand functia arunca — un esec lent e exact ce vrem sa vedem', async () => {
    await expect(timed('analysis', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(readStageStats()[0].count).toBe(1);
  });

  it('timedSync() se poarta la fel pentru etapele sincrone', () => {
    expect(timedSync('derivatives', () => 7)).toBe(7);
    expect(() => timedSync('derivatives', () => { throw new Error('x'); })).toThrow('x');
    expect(readStageStats()[0].count).toBe(2);
  });

  it('masuratorile supravietuiesc unei reincarcari', () => {
    record('grouping', 42);
    flush();
    __resetMemoryForTests();
    const [s] = readStageStats();
    expect(s.stage).toBe('grouping');
    expect(s.totalMs).toBe(42);
  });

  it('o valoare corupta in stocare nu arunca, ci reporneste de la zero', () => {
    localStorage.setItem('lumin-stage-timing', 'nu e json');
    __resetMemoryForTests();
    expect(readStageStats()).toEqual([]);
    localStorage.setItem('lumin-stage-timing', '{"inventat":{"count":1,"totalMs":1,"sample":[1]}}');
    __resetMemoryForTests();
    expect(readStageStats()).toEqual([]);
  });

  it('resetul sterge tot, si din memorie si din stocare', () => {
    record('decode', 10);
    flush();
    resetStageStats();
    expect(readStageStats()).toEqual([]);
    expect(localStorage.getItem('lumin-stage-timing')).toBeNull();
  });

  it('nu scrie in stocare la fiecare masuratoare', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    for (let i = 0; i < 500; i++) record('decode', 1);
    // scrierea e amanata: bucla de import nu trebuie sa plateasca serializare
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
