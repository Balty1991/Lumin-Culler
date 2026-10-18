import { beforeEach, describe, expect, it } from 'vitest';
import { addFreedBytes, readFreedBytes } from './storageFreed';

beforeEach(() => localStorage.clear());

describe('storageFreed', () => {
  it('pornește de la zero și adună doar octeți reali', () => {
    expect(readFreedBytes()).toBe(0);
    expect(addFreedBytes(0)).toBe(0);
    expect(addFreedBytes(-4)).toBe(0);
    expect(addFreedBytes(1500)).toBe(1500);
    expect(addFreedBytes(500)).toBe(2000);
    expect(readFreedBytes()).toBe(2000);
  });
});
