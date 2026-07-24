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

  it('saves an optional renameTemplate/genre alongside the thresholds (session template)', () => {
    const after = saveCullingPreset('Nunta', 30, 40, { renameTemplate: '{client}_{eveniment}_{secventa}', genre: 'Nunta' });
    expect(after[0]).toMatchObject({ renameTemplate: '{client}_{eveniment}_{secventa}', genre: 'Nunta' });
  });

  it('omits renameTemplate/genre entirely when not provided (backward compatible with older presets)', () => {
    const after = saveCullingPreset('Nunta', 30, 40);
    expect(after[0].renameTemplate).toBeUndefined();
    expect(after[0].genre).toBeUndefined();
  });

  it('treats an empty-string renameTemplate the same as absent', () => {
    const after = saveCullingPreset('Nunta', 30, 40, { renameTemplate: '' });
    expect(after[0].renameTemplate).toBeUndefined();
  });
});
