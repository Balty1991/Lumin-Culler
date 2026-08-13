import { describe, expect, it } from 'vitest';
import { accumulate, affinity, MIN_SAMPLES } from './embeddingMemory';
import type { EmbeddingMemoryRecord } from '../db';

/** Memorie construita din N decizii identice de fiecare parte — destul cat semnalul sa fie considerat de incredere. */
function memoryFrom(kept: number[], rejected: number[], samples = MIN_SAMPLES): EmbeddingMemoryRecord {
  let memory: EmbeddingMemoryRecord | undefined;
  for (let i = 0; i < samples; i++) memory = accumulate(memory, kept, true);
  for (let i = 0; i < samples; i++) memory = accumulate(memory, rejected, false);
  return memory!;
}

describe('accumulate', () => {
  it('tine media incremental, fara sa retina pozele individuale', () => {
    const memory = accumulate(accumulate(undefined, [2, 0], true), [0, 2], true);
    expect(memory.keptCount).toBe(2);
    expect(memory.keptSum).toEqual([2, 2]); // suma; centroida = [1, 1]
    expect(memory.rejectedCount).toBe(0);
  });

  it('tine cele doua parti separat', () => {
    const memory = accumulate(accumulate(undefined, [1, 0], true), [0, 1], false);
    expect(memory.keptCount).toBe(1);
    expect(memory.rejectedCount).toBe(1);
  });

  it('reporneste suma daca modelul incepe sa dea embedding-uri de alta dimensiune', () => {
    const memory = accumulate(accumulate(undefined, [1, 1], true), [1, 1, 1], true);
    expect(memory.keptSum).toEqual([1, 1, 1]);
    expect(memory.keptCount).toBe(1); // nu amestecam doua spatii vectoriale diferite
  });
});

describe('affinity', () => {
  it('nu spune nimic pana nu exista destule decizii de AMBELE parti', () => {
    expect(affinity([1, 0], undefined)).toBeNull();
    let partial: EmbeddingMemoryRecord | undefined;
    for (let i = 0; i < MIN_SAMPLES; i++) partial = accumulate(partial, [1, 0], true);
    expect(affinity([1, 0], partial)).toBeNull(); // doar pastrate, nicio respingere
  });

  it('da peste 0.5 unei poze care seamana cu ce ai pastrat', () => {
    const memory = memoryFrom([1, 0], [0, 1]);
    expect(affinity([1, 0], memory)!).toBeGreaterThan(0.5);
  });

  it('da sub 0.5 unei poze care seamana cu ce ai respins', () => {
    const memory = memoryFrom([1, 0], [0, 1]);
    expect(affinity([0, 1], memory)!).toBeLessThan(0.5);
  });

  it('ramane in jur de 0.5 pentru o poza la fel de departe de ambele', () => {
    const memory = memoryFrom([1, 0], [-1, 0]);
    expect(affinity([0, 1], memory)!).toBeCloseTo(0.5, 5);
  });

  it('nu iese niciodata din 0..1, oricat de opuse ar fi centroidele', () => {
    const memory = memoryFrom([1, 0], [-1, 0]);
    expect(affinity([1, 0], memory)!).toBeLessThanOrEqual(1);
    expect(affinity([-1, 0], memory)!).toBeGreaterThanOrEqual(0);
  });

  it('nu spune nimic pentru o poza fara embedding', () => {
    expect(affinity([], memoryFrom([1, 0], [0, 1]))).toBeNull();
  });
});
