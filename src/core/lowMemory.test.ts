import { describe, it, expect, afterEach } from 'vitest';
import { lowMemoryDevice } from './nativeAnalysis';

const set = (v: number | undefined) => Object.defineProperty(navigator, 'deviceMemory', { value: v, configurable: true });

describe('lowMemoryDevice', () => {
  afterEach(() => set(undefined));
  it('4 GB sau mai puțin = telefon slab', () => { set(4); expect(lowMemoryDevice()).toBe(true); set(2); expect(lowMemoryDevice()).toBe(true); });
  it('8 GB = nu', () => { set(8); expect(lowMemoryDevice()).toBe(false); });
  it('necunoscut = nu (nu sărim nimic din prudență)', () => { set(undefined); expect(lowMemoryDevice()).toBe(false); });
});
