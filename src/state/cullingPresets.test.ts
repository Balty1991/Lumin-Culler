import { beforeEach, describe, expect, it } from 'vitest';
import { listCullingPresets, saveCullingPreset, deleteCullingPreset } from './cullingPresets';

beforeEach(() => localStorage.clear());

describe('cullingPresets', () => {
  it('starts empty', () => {
    expect(listCullingPresets()).toEqual([]);
  });

  it('saves a preset and lists it back, most recent first', () => {
    saveCullingPreset('Nunta', 30, 40);
    const after = saveCullingPreset('Sport', 60, 20);
    expect(after.map(p => p.name)).toEqual(['Sport', 'Nunta']);
    expect(after[0]).toMatchObject({ name: 'Sport', cullPercent: 60, rejectThreshold: 20 });
  });

  it('overwrites an existing preset with the same name (case-insensitive)', () => {
    saveCullingPreset('Nunta', 30, 40);
    const after = saveCullingPreset('NUNTA', 50, 10);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ cullPercent: 50, rejectThreshold: 10 });
  });

  it('ignores an empty/whitespace-only name without touching the stored list', () => {
    saveCullingPreset('Nunta', 30, 40);
    const after = saveCullingPreset('   ', 99, 99);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Nunta');
  });

  it('deletes a preset by id', () => {
    const [{ id }] = saveCullingPreset('Nunta', 30, 40);
    expect(deleteCullingPreset(id)).toEqual([]);
  });
});
