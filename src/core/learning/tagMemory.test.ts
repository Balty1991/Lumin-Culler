import { describe, expect, it } from 'vitest';
import { accumulateTags, tagAffinity, MIN_DECISIONS, MIN_TAG_OBSERVATIONS } from './tagMemory';
import type { TagMemoryRecord } from '../db';

/** Memorie construita din decizii repetate, destule cat semnalul sa fie considerat de incredere. */
function memoryFrom(keptTags: string[], rejectedTags: string[], rounds = MIN_DECISIONS): TagMemoryRecord {
  let memory: TagMemoryRecord | undefined;
  for (let i = 0; i < rounds; i++) memory = accumulateTags(memory, keptTags, true);
  for (let i = 0; i < rounds; i++) memory = accumulateTags(memory, rejectedTags, false);
  return memory!;
}

describe('accumulateTags', () => {
  it('numara fiecare eticheta de partea deciziei', () => {
    const memory = accumulateTags(accumulateTags(undefined, ['dog', 'grass'], true), ['receipt'], false);
    expect(memory.tags.dog).toEqual({ kept: 1, rejected: 0 });
    expect(memory.tags.receipt).toEqual({ kept: 0, rejected: 1 });
    expect(memory.keptTotal).toBe(1);
    expect(memory.rejectedTotal).toBe(1);
  });

  it('numara o eticheta o singura data chiar daca poza o are de doua ori', () => {
    const memory = accumulateTags(undefined, ['dog', 'dog'], true);
    expect(memory.tags.dog).toEqual({ kept: 1, rejected: 0 });
  });

  it('o poza fara etichete nu schimba nimic, nici macar totalurile', () => {
    const before = accumulateTags(undefined, ['dog'], true);
    expect(accumulateTags(before, undefined, true)).toBe(before);
    expect(accumulateTags(before, [], false)).toBe(before);
  });
});

describe('tagAffinity', () => {
  it('nu spune nimic pana nu exista destule decizii de ambele parti', () => {
    expect(tagAffinity(['dog'], undefined)).toBeNull();
    let onlyKept: TagMemoryRecord | undefined;
    for (let i = 0; i < MIN_DECISIONS; i++) onlyKept = accumulateTags(onlyKept, ['dog'], true);
    expect(tagAffinity(['dog'], onlyKept)).toBeNull();
  });

  it('inclina spre pastrare pentru un subiect pe care il tii', () => {
    const memory = memoryFrom(['dog'], ['receipt']);
    expect(tagAffinity(['dog'], memory)!).toBeGreaterThan(0.5);
  });

  it('inclina spre respingere pentru un subiect pe care il arunci', () => {
    const memory = memoryFrom(['dog'], ['receipt']);
    expect(tagAffinity(['receipt'], memory)!).toBeLessThan(0.5);
  });

  it('ignora etichetele vazute prea rar ca sa insemne ceva', () => {
    const memory = memoryFrom(['dog'], ['receipt']);
    expect(memory.tags.necunoscut).toBeUndefined();
    expect(tagAffinity(['necunoscut'], memory)).toBeNull();

    const rare = accumulateTags(memory, ['abia-vazut'], true);
    expect(rare.tags['abia-vazut'].kept).toBeLessThan(MIN_TAG_OBSERVATIONS);
    expect(tagAffinity(['abia-vazut'], rare)).toBeNull();
  });

  it('ramane in 0..1 chiar la etichete complet dezechilibrate', () => {
    const memory = memoryFrom(['dog'], ['receipt'], 50);
    const kept = tagAffinity(['dog'], memory)!;
    const rejected = tagAffinity(['receipt'], memory)!;
    expect(kept).toBeLessThanOrEqual(1);
    expect(rejected).toBeGreaterThanOrEqual(0);
    expect(kept).toBeGreaterThan(rejected);
  });

  it('mediaza cand poza are si un subiect bun si unul rau', () => {
    const memory = memoryFrom(['dog'], ['receipt'], 30);
    const mixed = tagAffinity(['dog', 'receipt'], memory)!;
    expect(mixed).toBeGreaterThan(tagAffinity(['receipt'], memory)!);
    expect(mixed).toBeLessThan(tagAffinity(['dog'], memory)!);
  });
});
